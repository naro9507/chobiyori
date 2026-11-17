import type { Preview, Shape } from "./documents-api"

/**
 * 書類の紙面。Rust が PDF と同じ配置で組んだ図形を SVG で描く。紙面は印刷物なので、
 * 画面の配色（ダーク）に合わせず白い紙に黒い文字で描く（色は PDF と同じ値）。
 */
export function DocumentPreview({
	preview,
	label,
}: {
	preview: Preview
	label: string
}) {
	return (
		<div className="flex flex-col gap-4" role="img" aria-label={label}>
			{preview.pages.map((page, index) => (
				<svg
					// biome-ignore lint/suspicious/noArrayIndexKey: ページの順は変わらない
					key={index}
					viewBox={`0 0 ${page.width} ${page.height}`}
					className="w-full rounded-md border shadow-sm"
					style={{ background: "white" }}
					aria-hidden="true"
				>
					{page.shapes.map((shape, i) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: 図形の順は変わらない
						<ShapeView key={i} shape={shape} preview={preview} />
					))}
				</svg>
			))}
		</div>
	)
}

/** 0（黒）〜255（白）の灰色。紙面の色なので、テーマの色ではなく PDF と同じ値を使う。 */
function gray(level: number) {
	return `rgb(${level}, ${level}, ${level})`
}

function ShapeView({ shape, preview }: { shape: Shape; preview: Preview }) {
	switch (shape.type) {
		case "text":
			return (
				<text
					x={shape.x}
					y={shape.y}
					fontSize={shape.size}
					textAnchor={shape.anchor}
					fill={gray(20)}
					style={{
						fontFamily:
							'"Yu Gothic", YuGothic, "Hiragino Sans", "Hiragino Kaku Gothic ProN", Meiryo, "IPAexGothic", "IPAGothic", "Noto Sans CJK JP", sans-serif',
						whiteSpace: "pre",
					}}
				>
					{shape.text}
				</text>
			)
		case "line":
			return (
				<line
					x1={shape.x1}
					y1={shape.y1}
					x2={shape.x2}
					y2={shape.y2}
					stroke={gray(shape.gray)}
					strokeWidth={shape.width}
				/>
			)
		case "rect":
			return (
				<rect
					x={shape.x}
					y={shape.y}
					width={shape.w}
					height={shape.h}
					fill={gray(shape.gray)}
				/>
			)
		case "image": {
			const href = shape.role === "logo" ? preview.logo : preview.seal
			return href ? (
				<image
					href={href}
					x={shape.x}
					y={shape.y}
					width={shape.w}
					height={shape.h}
				/>
			) : null
		}
	}
}
