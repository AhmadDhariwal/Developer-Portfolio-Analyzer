import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

export type LoaderSize = 'sm' | 'md' | 'lg';

@Component({
  selector: 'app-ui-loader, app-shared-loader',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './loader.component.html',
  styleUrls: ['./loader.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SharedLoaderComponent {
  @Input() loading: boolean = false;
  @Input() label: string = 'Loading data';
  @Input() size: LoaderSize = 'md';
  @Input() fullscreen: boolean = false;
}

export { SharedLoaderComponent as UiLoaderComponent };
