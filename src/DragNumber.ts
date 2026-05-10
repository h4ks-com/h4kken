export class DragNumber {
  private _value: number;
  private dragging = false;
  private dragStartX = 0;
  private dragStartVal = 0;
  onChange: () => void = () => {};

  constructor(
    private readonly el: HTMLElement,
    init: number,
    private readonly normalSpeed: number,
    private readonly fineSpeed: number,
    private readonly decimals: number,
    private readonly min = -Infinity,
    private readonly max = Infinity,
  ) {
    this._value = init;
    this._refresh();
    this._bind();
  }

  get(): number { return this._value; }

  set(v: number): void {
    this._value = Math.max(this.min, Math.min(this.max, v));
    this._refresh();
  }

  private _refresh(): void {
    this.el.textContent = this._value.toFixed(this.decimals);
  }

  private _bind(): void {
    const el = this.el;

    const onMove = (e: MouseEvent) => {
      if (!this.dragging) return;
      const dx = e.clientX - this.dragStartX;
      const speed = e.shiftKey ? this.fineSpeed : this.normalSpeed;
      this._value = Math.max(this.min, Math.min(this.max, this.dragStartVal + dx * speed));
      this._refresh();
      this.onChange();
    };

    const onUp = () => {
      if (!this.dragging) return;
      this.dragging = false;
      el.classList.remove('dragging');
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    el.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      this.dragging = true;
      this.dragStartX = e.clientX;
      this.dragStartVal = this._value;
      el.classList.add('dragging');
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });

    el.addEventListener('dblclick', () => this._showInput());
  }

  private _showInput(): void {
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.value = this._value.toFixed(this.decimals);
    const rect = this.el.getBoundingClientRect();
    Object.assign(inp.style, {
      position: 'fixed',
      left: `${rect.left}px`,
      top: `${rect.top - 1}px`,
      width: `${Math.max(rect.width + 8, 72)}px`,
      fontSize: '10px',
      fontFamily: 'monospace',
      background: '#111',
      color: '#8cf',
      border: '1px solid #5af',
      padding: '2px 4px',
      zIndex: '9999',
      boxSizing: 'border-box',
      borderRadius: '2px',
      outline: 'none',
    });
    document.body.appendChild(inp);
    inp.focus();
    inp.select();

    const commit = () => {
      const v = parseFloat(inp.value);
      if (!isNaN(v)) this.set(v);
      this.onChange();
      inp.remove();
    };
    inp.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); commit(); }
      else if (ev.key === 'Escape') inp.remove();
      ev.stopPropagation();
    });
    inp.addEventListener('blur', commit);
  }
}
