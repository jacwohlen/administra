import { describe, it, expect, beforeEach } from 'vitest';
import { modalDialog } from './modalDialog';

describe('modalDialog', () => {
  let opener: HTMLButtonElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
  });

  function dialog(html: string) {
    const node = document.createElement('div');
    node.innerHTML = html;
    document.body.append(node);
    return node;
  }

  it('marks the box as a labelled modal dialog', () => {
    const node = dialog('<h3>Delete?</h3><button>OK</button>');
    modalDialog(node);
    expect(node.getAttribute('role')).toBe('dialog');
    expect(node.getAttribute('aria-modal')).toBe('true');
    const heading = node.querySelector('h3')!;
    expect(heading.id).not.toBe('');
    expect(node.getAttribute('aria-labelledby')).toBe(heading.id);
  });

  it('moves focus into the dialog so Escape reaches the overlay', () => {
    const node = dialog('<button>OK</button>');
    modalDialog(node);
    expect(document.activeElement).toBe(node);
  });

  it('keeps focus on an element inside that already took it', () => {
    const node = dialog('<input />');
    node.querySelector('input')!.focus();
    modalDialog(node);
    expect(document.activeElement).toBe(node.querySelector('input'));
  });

  it('gives focus back to the opener when it closes', () => {
    const node = dialog('<button>OK</button>');
    const action = modalDialog(node);
    node.remove();
    action.destroy();
    expect(document.activeElement).toBe(opener);
  });
});
