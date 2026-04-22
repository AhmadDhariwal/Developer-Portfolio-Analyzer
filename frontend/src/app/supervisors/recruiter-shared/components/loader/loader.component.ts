import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-loader',
  standalone: false,
  templateUrl: './loader.component.html',
  styleUrls: ['./loader.component.scss']
})
export class LoaderComponent {
  @Input() loading = false;
  @Input() label = 'Loading...';
  @Input() type: 'spinner' | 'skeleton' = 'spinner';
}
