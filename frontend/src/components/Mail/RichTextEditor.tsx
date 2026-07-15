import { useEditor, EditorContent, Extension } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import Underline from '@tiptap/extension-underline'
import TextAlign from '@tiptap/extension-text-align'
import Image from '@tiptap/extension-image'
import TextStyle from '@tiptap/extension-text-style'
import Color from '@tiptap/extension-color'
import { useEffect, useRef, useState } from 'react'
import { htmlToPlainLines, plainLinesToHtml } from '@/utils/emailBodyFormat'
import styles from './RichTextEditor.module.css'

const LineHeight = Extension.create({
  name: 'lineHeight',
  addGlobalAttributes() {
    return [
      {
        types: ['paragraph', 'heading'],
        attributes: {
          lineHeight: {
            default: null,
            parseHTML: (element) => element.style.lineHeight || null,
            renderHTML: (attributes) => {
              if (!attributes.lineHeight) return {}
              return { style: `line-height: ${attributes.lineHeight}` }
            },
          },
        },
      },
    ]
  },
})

const FontSize = Extension.create({
  name: 'fontSize',
  addGlobalAttributes() {
    return [
      {
        types: ['textStyle'],
        attributes: {
          fontSize: {
            default: null,
            parseHTML: (element) => element.style.fontSize || null,
            renderHTML: (attributes) => {
              if (!attributes.fontSize) return {}
              return { style: `font-size: ${attributes.fontSize}` }
            },
          },
        },
      },
    ]
  },
})

interface RichTextEditorProps {
  value: string
  onChange: (html: string) => void
  placeholder?: string
  onUploadImage?: (file: File) => Promise<string>
  isPlainTextMode?: boolean
  onModeChange?: (plain: boolean) => void
}

export function RichTextEditor({
  value,
  onChange,
  placeholder = 'Текст письма…',
  onUploadImage,
  isPlainTextMode = false,
  onModeChange,
}: RichTextEditorProps) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [plainTextMode, setPlainTextMode] = useState(isPlainTextMode)
  const [plainText, setPlainText] = useState(() => (isPlainTextMode ? htmlToPlainLines(value) : ''))
  const htmlSnapshotRef = useRef<string | null>(null)

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Link.configure({ openOnClick: false }),
      Placeholder.configure({ placeholder }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Image.configure({ inline: true }),
      TextStyle,
      Color,
      LineHeight,
      FontSize,
    ],
    content: value,
    onUpdate: ({ editor: ed }) => {
      if (!plainTextMode) onChange(ed.getHTML())
    },
  })

  useEffect(() => {
    if (isPlainTextMode !== plainTextMode) {
      setPlainTextMode(isPlainTextMode)
      if (isPlainTextMode) {
        if (editor) {
          const html = editor.getHTML()
          htmlSnapshotRef.current = html
          const text = htmlToPlainLines(html)
          setPlainText(text)
          onChange(plainLinesToHtml(text))
        }
      } else {
        if (editor) {
          const snapshot = htmlSnapshotRef.current
          const unchanged = snapshot !== null && htmlToPlainLines(snapshot) === plainText
          const html = unchanged && snapshot ? snapshot : plainLinesToHtml(plainText)
          editor.commands.setContent(html)
          onChange(html)
          htmlSnapshotRef.current = null
        }
      }
    }
  }, [isPlainTextMode, editor])

  useEffect(() => {
    if (!editor || plainTextMode) return
    if (editor.getHTML() !== value) {
      editor.commands.setContent(value, false)
    }
  }, [editor, value, plainTextMode])

  if (!editor) return null

  function insertImage(file: File) {
    if (onUploadImage) {
      void onUploadImage(file)
        .then((src) => {
          if (src) editor?.chain().focus().setImage({ src }).run()
        })
        .catch(() => undefined)
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const src = typeof reader.result === 'string' ? reader.result : ''
      if (src) editor?.chain().focus().setImage({ src }).run()
    }
    reader.readAsDataURL(file)
  }

  function switchToPlainText() {
    if (!editor) return
    const html = editor.getHTML()
    htmlSnapshotRef.current = html
    const text = htmlToPlainLines(html)
    setPlainText(text)
    setPlainTextMode(true)
    onChange(plainLinesToHtml(text))
  }

  function switchToHtml() {
    if (!editor) return
    const snapshot = htmlSnapshotRef.current
    const unchanged = snapshot !== null && htmlToPlainLines(snapshot) === plainText
    const html = unchanged && snapshot ? snapshot : plainLinesToHtml(plainText)
    editor.commands.setContent(html)
    onChange(html)
    htmlSnapshotRef.current = null
    setPlainTextMode(false)
  }

  function togglePlainTextMode() {
    const next = !plainTextMode
    if (next) switchToPlainText()
    else switchToHtml()
    onModeChange?.(next)
  }

  function handlePlainTextChange(text: string) {
    setPlainText(text)
    onChange(plainLinesToHtml(text))
  }

  return (
    <div className={styles.editor}>
      <div className={styles.toolbar}>
        {!plainTextMode && (
          <>
            <button
              type="button"
              className={`${styles.toolBtn} ${editor.isActive('bold') ? styles.toolBtnActive : ''}`}
              onClick={() => editor.chain().focus().toggleBold().run()}
            >
              B
            </button>
            <button
              type="button"
              className={`${styles.toolBtn} ${editor.isActive('italic') ? styles.toolBtnActive : ''}`}
              onClick={() => editor.chain().focus().toggleItalic().run()}
            >
              I
            </button>
            <button
              type="button"
              className={`${styles.toolBtn} ${editor.isActive('underline') ? styles.toolBtnActive : ''}`}
              onClick={() => editor.chain().focus().toggleUnderline().run()}
            >
              U
            </button>
            <div className={styles.divider} />
            <button
              type="button"
              className={styles.toolBtn}
              onClick={() => {
                const currentSize = editor.getAttributes('textStyle').fontSize || '1em'
                const newSize = currentSize === '1.25em' ? '1.5em' : currentSize === '1.5em' ? '1em' : '1.25em'
                editor.chain().focus().setMark('textStyle', { fontSize: newSize }).run()
              }}
              title="Размер шрифта"
            >
              AA
            </button>
            <button
              type="button"
              className={styles.toolBtn}
              onClick={() => {
                const currentHeight = editor.getAttributes('paragraph').lineHeight || '1.5'
                const newHeight = currentHeight === '1.5' ? '2' : currentHeight === '2' ? '1' : '1.5'
                editor.chain().focus().updateAttributes('paragraph', { lineHeight: newHeight }).run()
              }}
              title="Межстрочный интервал"
            >
              ↕
            </button>
            <div className={styles.divider} />
            <button
              type="button"
              className={styles.toolBtn}
              onClick={() => editor.chain().focus().setTextAlign('left').run()}
            >
              ⬅
            </button>
            <button
              type="button"
              className={styles.toolBtn}
              onClick={() => editor.chain().focus().setTextAlign('center').run()}
            >
              ↔
            </button>
            <button
              type="button"
              className={styles.toolBtn}
              onClick={() => editor.chain().focus().setTextAlign('right').run()}
            >
              ➡
            </button>
            <button
              type="button"
              className={`${styles.toolBtn} ${editor.isActive('bulletList') ? styles.toolBtnActive : ''}`}
              onClick={() => editor.chain().focus().toggleBulletList().run()}
            >
              • List
            </button>
            <button
              type="button"
              className={styles.toolBtn}
              onClick={() => editor.chain().focus().clearNodes().unsetAllMarks().run()}
              title="Очистить форматирование"
            >
              🧹
            </button>
            <button type="button" className={styles.toolBtn} onClick={() => fileRef.current?.click()} title="Вставить картинку">
              🖼
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className={styles.hiddenFile}
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) insertImage(file)
                e.target.value = ''
              }}
            />
          </>
        )}
        <button
          type="button"
          className={`${styles.toolBtn} ${plainTextMode ? styles.toolBtnActive : ''}`}
          onClick={togglePlainTextMode}
          title={plainTextMode ? 'Переключить в HTML-режим' : 'Переключить в текстовый режим'}
        >
          {plainTextMode ? 'HTML' : 'TXT'}
        </button>
      </div>

      {plainTextMode ? (
        <textarea
          className={styles.plainTextarea}
          value={plainText}
          onChange={(e) => handlePlainTextChange(e.target.value)}
          placeholder={placeholder}
          rows={Math.max(10, plainText.split('\n').length + 1)}
        />
      ) : (
        <EditorContent editor={editor} className={styles.content} />
      )}
    </div>
  )
}
