use super::{failed, plan::Deadline, Provider};
use chobiyori_core::error::{AppError, AppResult, ErrorCode};
use reqwest::{Client, RequestBuilder, Response, StatusCode, Url};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::BTreeMap;

const GOOGLE_MARKER: &str = "chobiyoriFilingDeadline";
const OUTLOOK_MARKER: &str =
    "String {43951945-2e2b-4505-a215-1d7c04d4608a} Name ChobiyoriFilingDeadline";
const GOOGLE_ORIGIN: &str = "https://www.googleapis.com";
const OUTLOOK_ORIGIN: &str = "https://graph.microsoft.com";
const CALENDAR_NAME: &str = "帳日和 / Chobiyori";

struct Event {
    id: String,
    key: String,
    value: Value,
}

pub(super) struct CalendarApi<'a> {
    pub provider: Provider,
    pub client: &'a Client,
    pub token: &'a str,
}

impl CalendarApi<'_> {
    pub async fn create_calendar(&self) -> AppResult<String> {
        let (url, body) = match self.provider {
            Provider::Google => (
                format!("{GOOGLE_ORIGIN}/calendar/v3/calendars"),
                json!({ "summary": CALENDAR_NAME }),
            ),
            Provider::Outlook => (
                format!("{OUTLOOK_ORIGIN}/v1.0/me/calendars"),
                json!({ "name": CALENDAR_NAME }),
            ),
        };
        let value = json_response(self.send(self.client.post(url), Some(body)).await?).await?;
        value["id"].as_str().map(str::to_owned).ok_or_else(failed)
    }

    /// Returns false when the destination calendar was removed or is no longer accessible.
    pub async fn sync(&self, calendar_id: &str, deadlines: &[Deadline]) -> AppResult<bool> {
        let url = self.events_url(calendar_id)?;
        let Some(events) = self.events(&url).await? else {
            return Ok(false);
        };
        let mut desired: BTreeMap<_, _> = deadlines
            .iter()
            .map(|deadline| (deadline.key.as_str(), deadline))
            .collect();

        for event in events {
            let mut item = url.clone();
            item.path_segments_mut()
                .map_err(|_| failed())?
                .push(&event.id);
            if let Some(deadline) = desired.remove(event.key.as_str()) {
                if !self.matches(&event.value, deadline) {
                    let body = self.event_body(deadline, false);
                    check(self.send(self.client.patch(item), Some(body)).await?)?;
                }
            } else {
                let response = self.send(self.client.delete(item), None).await?;
                if response.status() != StatusCode::NOT_FOUND
                    && response.status() != StatusCode::GONE
                {
                    check(response)?;
                }
            }
        }
        for deadline in desired.into_values() {
            check(
                self.send(
                    self.client.post(url.clone()),
                    Some(self.event_body(deadline, true)),
                )
                .await?,
            )?;
        }
        Ok(true)
    }

    fn events_url(&self, calendar_id: &str) -> AppResult<Url> {
        let (base, segments): (_, &[&str]) = match self.provider {
            Provider::Google => (GOOGLE_ORIGIN, &["calendar", "v3", "calendars"]),
            Provider::Outlook => (OUTLOOK_ORIGIN, &["v1.0", "me", "calendars"]),
        };
        let mut url = Url::parse(base).map_err(|_| failed())?;
        url.path_segments_mut()
            .map_err(|_| failed())?
            .pop_if_empty()
            .extend(segments.iter().copied())
            .push(calendar_id)
            .push("events");
        Ok(url)
    }

    async fn events(&self, base: &Url) -> AppResult<Option<Vec<Event>>> {
        let mut next = base.clone();
        match self.provider {
            Provider::Google => {
                next.query_pairs_mut()
                    .append_pair("showDeleted", "false")
                    .append_pair("maxResults", "250")
                    .append_pair(
                        "fields",
                        "nextPageToken,items(id,summary,start/date,end/date,extendedProperties/private)",
                    );
            }
            Provider::Outlook => {
                next.query_pairs_mut()
                    .append_pair(
                        "$select",
                        "id,subject,start,end,isAllDay,singleValueExtendedProperties",
                    )
                    .append_pair(
                        "$expand",
                        &format!("singleValueExtendedProperties($filter=id eq '{OUTLOOK_MARKER}')"),
                    );
            }
        }
        let first = next.clone();
        let mut events = Vec::new();
        loop {
            let response = self.send(self.client.get(next.clone()), None).await?;
            if next == first
                && matches!(response.status(), StatusCode::NOT_FOUND | StatusCode::GONE)
            {
                return Ok(None);
            }
            let page = json_response(response).await?;
            match self.provider {
                Provider::Google => {
                    let page: GooglePage = serde_json::from_value(page).map_err(|_| failed())?;
                    events.extend(
                        page.items
                            .into_iter()
                            .filter_map(|event| self.managed_event(event)),
                    );
                    let Some(token) = page.next_page_token else {
                        break;
                    };
                    next = first.clone();
                    next.query_pairs_mut().append_pair("pageToken", &token);
                }
                Provider::Outlook => {
                    let page: OutlookPage = serde_json::from_value(page).map_err(|_| failed())?;
                    events.extend(
                        page.value
                            .into_iter()
                            .filter_map(|event| self.managed_event(event)),
                    );
                    let Some(link) = page.next_link else { break };
                    next = Url::parse(&link).map_err(|_| failed())?;
                    if next.origin() != base.origin()
                        || !next.username().is_empty()
                        || next.password().is_some()
                    {
                        return Err(failed());
                    }
                }
            }
        }
        Ok(Some(events))
    }

    fn managed_event(&self, value: Value) -> Option<Event> {
        let key = match self.provider {
            Provider::Google => value["extendedProperties"]["private"][GOOGLE_MARKER].as_str(),
            Provider::Outlook => value["singleValueExtendedProperties"]
                .as_array()?
                .iter()
                .find(|property| property["id"].as_str() == Some(OUTLOOK_MARKER))?["value"]
                .as_str(),
        }?;
        Some(Event {
            id: value["id"].as_str()?.to_owned(),
            key: key.to_owned(),
            value,
        })
    }

    fn matches(&self, event: &Value, deadline: &Deadline) -> bool {
        match self.provider {
            Provider::Google => {
                event["summary"].as_str() == Some(&deadline.title)
                    && event["start"]["date"].as_str() == Some(&deadline.date)
                    && event["end"]["date"].as_str() == Some(&deadline.end)
            }
            Provider::Outlook => {
                event["subject"].as_str() == Some(&deadline.title)
                    && event["isAllDay"].as_bool() == Some(true)
                    && outlook_date(&event["start"]) == Some(&deadline.date)
                    && outlook_date(&event["end"]) == Some(&deadline.end)
            }
        }
    }

    fn event_body(&self, deadline: &Deadline, creating: bool) -> Value {
        match self.provider {
            Provider::Google => {
                let mut body = json!({
                    "summary": deadline.title,
                    "start": { "date": deadline.date },
                    "end": { "date": deadline.end },
                });
                if creating {
                    body["extendedProperties"] =
                        json!({ "private": { (GOOGLE_MARKER): deadline.key } });
                }
                body
            }
            Provider::Outlook => {
                let mut body = json!({
                    "subject": deadline.title,
                    "isAllDay": true,
                    "start": { "dateTime": format!("{}T00:00:00", deadline.date), "timeZone": "UTC" },
                    "end": { "dateTime": format!("{}T00:00:00", deadline.end), "timeZone": "UTC" },
                });
                if creating {
                    body["singleValueExtendedProperties"] =
                        json!([{ "id": OUTLOOK_MARKER, "value": deadline.key }]);
                }
                body
            }
        }
    }

    async fn send(&self, request: RequestBuilder, body: Option<Value>) -> AppResult<Response> {
        let mut request = request.bearer_auth(self.token);
        if matches!(self.provider, Provider::Outlook) {
            request = request.header("Prefer", "outlook.timezone=\"UTC\"");
        }
        if let Some(body) = body {
            request = request
                .header("content-type", "application/json")
                .body(body.to_string());
        }
        request.send().await.map_err(|_| failed())
    }
}

fn outlook_date(value: &Value) -> Option<&str> {
    let time = value["dateTime"].as_str()?;
    time.get(10..19).filter(|suffix| *suffix == "T00:00:00")?;
    time.get(..10)
}

fn check(response: Response) -> AppResult<Response> {
    let status = response.status();
    if status.is_success() {
        return Ok(response);
    }
    if status == StatusCode::UNAUTHORIZED {
        return Err(AppError::new(ErrorCode::CalendarAuth));
    }
    Err(failed())
}

async fn json_response(response: Response) -> AppResult<Value> {
    let body = check(response)?.text().await.map_err(|_| failed())?;
    serde_json::from_str(&body).map_err(|_| failed())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GooglePage {
    #[serde(default)]
    items: Vec<Value>,
    next_page_token: Option<String>,
}

#[derive(Deserialize)]
struct OutlookPage {
    value: Vec<Value>,
    #[serde(rename = "@odata.nextLink")]
    next_link: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn provider_payloads_round_trip_managed_all_day_events() {
        let client = super::super::http_client().unwrap();
        let deadline = Deadline {
            key: "income-2026".into(),
            title: "確定申告の期限 (2026)".into(),
            date: "2027-03-15".into(),
            end: "2027-03-16".into(),
        };
        for provider in [Provider::Google, Provider::Outlook] {
            let api = CalendarApi {
                client: &client,
                provider,
                token: "unused",
            };
            let mut event = api.event_body(&deadline, true);
            let id = "event/id";
            event["id"] = json!(id);
            assert!(api.matches(&event, &deadline));
            let managed = api.managed_event(event).unwrap();
            assert_eq!(managed.key, deadline.key);
            assert_eq!(managed.id, id);
            assert!(api.managed_event(json!({ "id": id })).is_none());
            assert!(api
                .events_url("calendar/id")
                .unwrap()
                .path()
                .contains("calendar%2Fid"));
        }
    }
}
