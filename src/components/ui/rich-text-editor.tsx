import {
  EditorContent,
  useEditor,
  useEditorState,
  type Editor,
} from "@tiptap/react"
import Image from "@tiptap/extension-image"
import StarterKit from "@tiptap/starter-kit"
import {
  Bold,
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
}: {
  initialHtml?: string
  onChange: (html: string, text: string) => void
  className?: string
  autoFocus?: boolean
}) {
  const editor = useEditor({
    // inline so signature/quote images stay in their surrounding text flow
    extensions: [StarterKit, Image.configure({ inline: true })],
    content: initialHtml ?? "",
    autofocus: autoFocus ? "start" : false,
    onUpdate: ({ editor: e }) => onChange(e.getHTML(), e.getText()),
    editorProps: {
      attributes: {
        class: cn(
          "min-h-44 max-h-80 overflow-y-auto px-2.5 py-1.5 text-sm outline-none",
          // content styling (no typography plugin)
          "[&_p]:my-0.5 [&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-5",
          "[&_blockquote]:my-1 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground",
          "[&_a]:text-primary [&_a]:underline",
          "[&_img]:inline-block [&_img]:max-w-full",
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
    </div>
  )
}
