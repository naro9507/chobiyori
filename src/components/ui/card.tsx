import type * as React from "react"
import { cn } from "@/lib/utils"
import { HelpTip } from "./help-tip"

function Card({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="card"
			className={cn(
				"flex flex-col gap-4 rounded-xl border bg-card py-5 text-card-foreground",
				className
			)}
			{...props}
		/>
	)
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="card-header"
			className={cn("flex flex-col gap-1 px-5", className)}
			{...props}
		/>
	)
}

type CardTitleProps = React.ComponentProps<"h2"> &
	({ children: string; help: string } | { help?: undefined })

function CardTitle({ className, children, help, ...props }: CardTitleProps) {
	const title = (
		<h2
			data-slot="card-title"
			className={cn("font-bold text-base leading-snug", className)}
			{...props}
		>
			{children}
		</h2>
	)
	if (help === undefined) return title

	return (
		<div className="flex min-w-0 items-center gap-1">
			{title}
			<HelpTip topic={children}>{help}</HelpTip>
		</div>
	)
}

function CardDescription({ className, ...props }: React.ComponentProps<"p">) {
	return (
		<p
			data-slot="card-description"
			className={cn("text-muted-foreground text-sm", className)}
			{...props}
		/>
	)
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="card-content"
			className={cn("px-5", className)}
			{...props}
		/>
	)
}

export { Card, CardContent, CardDescription, CardHeader, CardTitle }
