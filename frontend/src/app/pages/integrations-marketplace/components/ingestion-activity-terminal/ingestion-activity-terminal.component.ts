import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IngestionLogEntry } from '../../config/marketplace.models';
@Component({
  selector: 'section[appIngestionActivityTerminal]',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './ingestion-activity-terminal.component.html',
  styleUrl: './ingestion-activity-terminal.component.scss',
})
export class IngestionActivityTerminalComponent {
  @Input() terminalLogs: IngestionLogEntry[] = [];
  @Output() readonly closeTerminal = new EventEmitter<void>();
}
