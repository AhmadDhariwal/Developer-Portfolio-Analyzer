import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, Input, OnChanges } from '@angular/core';

interface ContentBlock {
  kind: 'text' | 'heading' | 'code' | 'list';
  text?: string;
  items?: string[];
  ordered?: boolean;
}

@Component({
  selector: 'app-interview-answer-content',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *ngFor="let block of blocks">
      <h5 *ngIf="block.kind === 'heading'">{{ block.text }}</h5>
      <p *ngIf="block.kind === 'text'">{{ block.text }}</p>
      <pre *ngIf="block.kind === 'code'"><code>{{ block.text }}</code></pre>
      <ol *ngIf="block.kind === 'list' && block.ordered">
        <li *ngFor="let item of block.items">{{ item }}</li>
      </ol>
      <ul *ngIf="block.kind === 'list' && !block.ordered">
        <li *ngFor="let item of block.items">{{ item }}</li>
      </ul>
    </ng-container>
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
      max-width: 100%;
      overflow-wrap: anywhere;
    }
    p {
      white-space: pre-wrap;
      margin: 0 0 12px;
    }
    h5 {
      font-size: 1em;
      margin: 16px 0 8px;
    }
    pre {
      max-width: 100%;
      overflow-x: auto;
      white-space: pre;
      padding: 12px;
      border-radius: 6px;
      background: var(--bg-secondary, #f1f5f9);
    }
    code {
      font-family: monospace;
      font-size: 0.9em;
    }
    ol,
    ul {
      padding-inline-start: 24px;
      margin: 8px 0 12px;
    }
    li {
      margin-bottom: 6px;
      white-space: pre-wrap;
    }
  `,
})
export class InterviewAnswerContentComponent implements OnChanges {
  @Input() text = '';
  @Input() code = false;
  blocks: ContentBlock[] = [];

  ngOnChanges(): void {
    const text = String(this.text || '');
    if (this.code && !text.includes('```')) {
      this.blocks = [{ kind: 'code', text }];
      return;
    }
    const blocks: ContentBlock[] = [];
    let codeLines: string[] | null = null;
    for (const line of text.split('\n')) {
      if (/^\s*```/.test(line)) {
        if (codeLines) {
          blocks.push({ kind: 'code', text: codeLines.join('\n') });
          codeLines = null;
        } else codeLines = [];
        continue;
      }
      if (codeLines) {
        codeLines.push(line);
        continue;
      }
      if (!line.trim()) continue;
      const heading = line.match(/^\s*#{1,6}\s+(.+)$/);
      const list = line.match(/^\s*(\d+[.)]|[-*])\s+(.+)$/);
      if (heading) blocks.push({ kind: 'heading', text: heading[1] });
      else if (list) {
        const ordered = /^\d/.test(list[1]);
        const prior = blocks.at(-1);
        if (prior?.kind === 'list' && prior.ordered === ordered) prior.items?.push(list[2]);
        else blocks.push({ kind: 'list', items: [list[2]], ordered });
      } else blocks.push({ kind: 'text', text: line });
    }
    if (codeLines) blocks.push({ kind: 'code', text: codeLines.join('\n') });
    this.blocks = blocks;
  }
}
