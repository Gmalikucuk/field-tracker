import type { FormEvent, ReactNode } from 'react'

/**
 * Shared bottom-sheet modal shell for the Milling correction-family forms
 * (CorrectionForm, VoidReadingForm, InsertReadingAfterForm) — a
 * backdrop-anchored sheet whose action buttons (`actions`) live structurally
 * outside the scrollable content region (`children`), so they can never end
 * up hidden by their own overflow. The sheet itself never scrolls; only its
 * content region does (see MillingEntryScreen.css's
 * .milling-correction-form-split / .milling-correction-scroll) — this used
 * to be the whole sheet scrolling as one block, which let the fixed bottom
 * nav bar's higher stacking end up painted over the action buttons once
 * content grew tall enough to reach that far down.
 */
export function ModalSheet({
  onClose,
  onSubmit,
  children,
  actions,
}: {
  onClose: () => void
  onSubmit: (e: FormEvent) => void
  children: ReactNode
  actions: ReactNode
}) {
  return (
    <div className="milling-correction-backdrop" onClick={onClose}>
      <form
        className="milling-correction-form milling-correction-form-split"
        onClick={(e) => e.stopPropagation()}
        onSubmit={onSubmit}
      >
        <div className="milling-correction-scroll">{children}</div>
        <div className="milling-correction-actions">{actions}</div>
      </form>
    </div>
  )
}
