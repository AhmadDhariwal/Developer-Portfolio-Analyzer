import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-chart-container',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './chart-container.component.html',
  styleUrl: './chart-container.component.scss'
})
export class ChartContainerComponent {
  @Input() title: string = 'Chart';
  @Input() subtitle?: string;
  @Input() height: string = '300px';
}
