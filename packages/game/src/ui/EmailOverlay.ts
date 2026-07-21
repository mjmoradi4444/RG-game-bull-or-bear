/**
 * A single HTML <input> overlaid on the game canvas for the email screen
 * (PRD-ADMIN-EMAIL §5.2). The game is otherwise canvas-only, but a real input is
 * the right call here: native mobile keyboards, autofill, and accessibility for
 * free. Positioned in CSS pixels — the same space the game draws in (the canvas
 * fills the viewport and renders in CSS px), so a game-space rect maps 1:1.
 *
 * Guarded for non-DOM/SSR contexts so importing it never throws.
 */
export class EmailOverlay {
  private el: HTMLInputElement | null = null;
  private onEnter?: () => void;

  private ensure(): HTMLInputElement | null {
    if (this.el || typeof document === 'undefined') return this.el;
    const input = document.createElement('input');
    input.type = 'email';
    input.inputMode = 'email';
    input.autocomplete = 'email';
    input.autocapitalize = 'off';
    input.spellcheck = false;
    input.placeholder = 'you@example.com';
    Object.assign(input.style, {
      position: 'fixed',
      display: 'none',
      boxSizing: 'border-box',
      zIndex: '50',
      border: '1px solid #283154',
      borderRadius: '10px',
      background: '#0E1428',
      color: '#fff',
      font: "500 16px Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
      padding: '0 14px',
      outline: 'none',
    } as Partial<CSSStyleDeclaration>);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.onEnter?.();
    });
    document.body.appendChild(input);
    this.el = input;
    return input;
  }

  /** Show the input at a CSS-pixel rect and focus it. */
  show(rect: { x: number; y: number; w: number; h: number }, value: string, onEnter: () => void): void {
    const el = this.ensure();
    if (!el) return;
    this.onEnter = onEnter;
    el.style.left = `${rect.x}px`;
    el.style.top = `${rect.y}px`;
    el.style.width = `${rect.w}px`;
    el.style.height = `${rect.h}px`;
    el.style.display = 'block';
    if (el.value !== value) el.value = value;
    // Focus on the next frame so the tap that opened the screen doesn't blur it.
    requestAnimationFrame(() => {
      try {
        el.focus();
      } catch {
        /* ignore */
      }
    });
  }

  /** Keep the input aligned when the viewport resizes / the screen re-lays-out. */
  reposition(rect: { x: number; y: number; w: number; h: number }): void {
    if (!this.el || this.el.style.display === 'none') return;
    this.el.style.left = `${rect.x}px`;
    this.el.style.top = `${rect.y}px`;
    this.el.style.width = `${rect.w}px`;
    this.el.style.height = `${rect.h}px`;
  }

  value(): string {
    return this.el?.value ?? '';
  }

  setValue(v: string): void {
    if (this.el) this.el.value = v;
  }

  visible(): boolean {
    return !!this.el && this.el.style.display !== 'none';
  }

  hide(): void {
    if (this.el) {
      this.el.blur();
      this.el.style.display = 'none';
    }
  }
}
