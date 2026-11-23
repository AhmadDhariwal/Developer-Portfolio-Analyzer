import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-shortlist-card',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './shortlist-card.component.html',
  styleUrl: './shortlist-card.component.scss',
})
export class ShortlistCardComponent {
  @Input() item: any;
  @Input() hideActions = false;
  @Input() savingNotes = false;
  @Output() edit = new EventEmitter<any>();
  @Output() remove = new EventEmitter<any>();
  @Output() saveNotes = new EventEmitter<{ item: any; notes: string }>();
  @Output() statusChange = new EventEmitter<{ item: any; status: string }>();

  editingNote = false;
  noteDraft = '';

  readonly pipelineStages = [
    { key: 'shortlisted', label: 'Shortlisted' },
    { key: 'reviewing', label: 'Reviewing' },
    { key: 'contacted', label: 'Contacted' },
    { key: 'interview', label: 'Interview' },
  ];

  readonly stageOptions = [...this.pipelineStages, { key: 'rejected', label: 'Rejected' }];

  get normalizedStatus(): string {
    return String(this.item?.status || 'shortlisted').toLowerCase();
  }

  get currentStageIndex(): number {
    return this.pipelineStages.findIndex((stage) => stage.key === this.normalizedStatus);
  }

  get isFinalOrRejected(): boolean {
    return this.normalizedStatus === 'interview' || this.normalizedStatus === 'rejected';
  }

  get candidateRouteId(): string {
    if (this.item?.applicationId) return '';
    return String(
      this.item?.candidate?.id || this.item?.candidate?.userId || this.item?.candidateId || '',
    ).trim();
  }

  get jobRouteId(): string {
    return String(this.item?.job?._id || this.item?.jobId || '').trim();
  }

  get initial(): string {
    return (
      String(this.item?.candidate?.name || this.item?.candidate?.fullName || 'C')
        .trim()
        .charAt(0)
        .toUpperCase() || 'C'
    );
  }

  startEditNote(): void {
    this.noteDraft = String(this.item?.notes || '');
    this.editingNote = true;
  }

  cancelEditNote(): void {
    this.editingNote = false;
    this.noteDraft = '';
  }

  submitNote(): void {
    this.saveNotes.emit({ item: this.item, notes: this.noteDraft.trim() });
    this.editingNote = false;
  }

  onStageSelect(nextStatus: string): void {
    if (!nextStatus || nextStatus === this.normalizedStatus) return;
    this.statusChange.emit({ item: this.item, status: nextStatus });
  }
}
