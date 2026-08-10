import {
  EditorContent,
  useEditor,
  useEditorState,
  type Editor,
} from "@tiptap/react"
import Image from "@tiptap/extension-image"
import { Markdown } from "@tiptap/markdown"
import StarterKit from "@tiptap/starter-kit"
import {
  Bold,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  List,
  ListOrdered,
  Redo,
  Strikethrough,
  TextQuote,
  Undo,
  type LucideIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { useMention, type MentionConfig } from "@/components/ui/mention"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"

function ToolbarButton({
  icon: Icon,
  label,
  active,
  disabled,
  onClick,
}: {
  icon: LucideIcon
  label: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <Button
      type="button"
      variant={active ? "secondary" : "ghost"}
      size="icon"
      className="size-7"
      aria-label={label}
      title={label}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()} // keep editor selection
      onClick={onClick}
    >
      <Icon className="size-4" />
    </Button>
  )
}

function Toolbar({ editor }: { editor: Editor }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      heading1: e.isActive("heading", { level: 1 }),
      heading2: e.isActive("heading", { level: 2 }),
      heading3: e.isActive("heading", { level: 3 }),
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      strike: e.isActive("strike"),
      bulletList: e.isActive("bulletList"),
      orderedList: e.isActive("orderedList"),
      blockquote: e.isActive("blockquote"),
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  })

  const chain = () => editor.chain().focus()

  return (
    <div className="flex items-center gap-0.5 border-b border-input p-1">
      <ToolbarButton
        icon={Heading1}
        label="Heading 1"
        active={state.heading1}
        onClick={() => chain().toggleHeading({ level: 1 }).run()}
      />
      <ToolbarButton
        icon={Heading2}
        label="Heading 2"
        active={state.heading2}
        onClick={() => chain().toggleHeading({ level: 2 }).run()}
      />
      <ToolbarButton
        icon={Heading3}
        label="Heading 3"
        active={state.heading3}
        onClick={() => chain().toggleHeading({ level: 3 }).run()}
      />
      <Separator orientation="vertical" className="mx-1 h-5" />
      <ToolbarButton
        icon={Bold}
        label="Bold"
        active={state.bold}
        onClick={() => chain().toggleBold().run()}
      />
      <ToolbarButton
        icon={Italic}
        label="Italic"
        active={state.italic}
        onClick={() => chain().toggleItalic().run()}
      />
      <ToolbarButton
        icon={Strikethrough}
        label="Strikethrough"
        active={state.strike}
        onClick={() => chain().toggleStrike().run()}
      />
      <Separator orientation="vertical" className="mx-1 h-5" />
      <ToolbarButton
        icon={List}
        label="Bullet list"
        active={state.bulletList}
        onClick={() => chain().toggleBulletList().run()}
      />
      <ToolbarButton
        icon={ListOrdered}
        label="Numbered list"
        active={state.orderedList}
        onClick={() => chain().toggleOrderedList().run()}
      />
      <ToolbarButton
        icon={TextQuote}
        label="Quote"
        active={state.blockquote}
        onClick={() => chain().toggleBlockquote().run()}
      />
      <Separator orientation="vertical" className="mx-1 h-5" />
      <ToolbarButton
        icon={Undo}
        label="Undo"
        disabled={!state.canUndo}
        onClick={() => chain().undo().run()}
      />
      <ToolbarButton
        icon={Redo}
        label="Redo"
        disabled={!state.canRedo}
        onClick={() => chain().redo().run()}
      />
    </div>
  )
}

export function RichTextEditor({
  initialHtml,
  onChange,
  className,
  autoFocus,
  mention,
}: {
  initialHtml?: string
  onChange: (html: string, text: string, markdown: string) => void
  className?: string
  autoFocus?: boolean
  mention?: MentionConfig // enables Gmail-style @ mentions when provided
}) {
  const { extension: mentionExtension, popup: mentionPopup } =
    useMention(mention)
  const editor = useEditor({
    // inline so signature/quote images stay in their surrounding text flow
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Image.configure({ inline: true }),
      Markdown,
      ...(mentionExtension ? [mentionExtension] : []),
    ],
    content: initialHtml ?? "",
    contentType: "html",
    autofocus: autoFocus ? "start" : false,
    onUpdate: ({ editor: e }) =>
      onChange(e.getHTML(), e.getText(), e.getMarkdown()),
    editorProps: {
      attributes: {
        class: cn(
          "min-h-44 max-h-80 overflow-y-auto px-2.5 py-1.5 text-sm break-words outline-none",
          // content styling (no typography plugin)
          "[&_p]:my-0.5 [&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-5",
          "[&_h1]:mt-2 [&_h1]:mb-1 [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:mt-2 [&_h2]:mb-1 [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:mt-2 [&_h3]:mb-1 [&_h3]:text-base [&_h3]:font-semibold",
          "[&_blockquote]:my-1 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground",
          "[&_a]:text-primary [&_a]:underline",
          "[&_img]:inline-block [&_img]:max-w-full",
          "[&_pre]:my-1 [&_pre]:overflow-x-auto",
        ),
      },
    },
  })

  if (!editor) return null

  return (
    <div
      className={cn(
        "rounded-lg border border-input bg-transparent transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30",
        className,
      )}
    >
      <Toolbar editor={editor} />
      <EditorContent editor={editor} />
      {mentionPopup}
    </div>
  )
}
