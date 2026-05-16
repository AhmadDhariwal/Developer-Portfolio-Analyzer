import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-recruiter-loader',
  standalone: true,
  imports: [CommonModule],
  template: `<div class="loader"><span></span><p>{{ label }}</p></div>`,
  styles: [`.loader{display:flex;align-items:center;gap:.75rem;padding:1rem;color:#cbd5e1}span{width:18px;height:18px;border-radius:50%;border:2px solid rgba(99,102,241,.2);border-top-color:#6366f1;animation:spin .8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}p{margin:0}`]
})
export class LoaderComponent {
  @Input() label = 'Loading...';
}
