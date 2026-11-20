-- 旧版の既定文だけを取り除き、DocumentSettings の新しい既定値を使う。
UPDATE settings SET value = json_remove(value, '$.mailSubject')
WHERE key = 'documents.settings' AND json_valid(value)
  AND json_extract(value, '$.mailSubject') = '{書類}のご送付（{番号}）';

UPDATE settings SET value = json_remove(value, '$.mailBody')
WHERE key = 'documents.settings' AND json_valid(value)
  AND json_extract(value, '$.mailBody') = '{宛名} 様

いつもお世話になっております。{差出人}です。
{書類}（{番号}）をお送りします。
合計金額は {金額} 円です。{期限}

ご確認のほど、よろしくお願いいたします。

{差出人}';
