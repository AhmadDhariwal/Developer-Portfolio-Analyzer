import { Component, Input, Output, EventEmitter, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-file-upload',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './file-upload.component.html',
  styleUrl: './file-upload.component.scss'
})
export class FileUploadComponent {
  @Input() acceptedTypes: string = '.pdf,.doc,.docx';
  @Input() maxSize: number = 5 * 1024 * 1024; // 5MB
  @Input() placeholder: string = 'Drop your resume here or click to select';
  @Output() fileSelected = new EventEmitter<File>();
  @Output() error = new EventEmitter<string>();

  isDragging = false;
  selectedFile: File | null = null;

  @HostListener('dragover', ['$event']) onDragOver(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging = true;
  }

  @HostListener('dragleave', ['$event']) onDragLeave(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging = false;
  }

  @HostListener('drop', ['$event']) onDrop(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging = false;

    const files = event.dataTransfer?.files;
    if (files && files.length > 0) {
      this.handleFile(files[0]);
    }
  }

  onFileInputChange(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.handleFile(input.files[0]);
    }
  }

  private handleFile(file: File) {
    if (!file.name.match(new RegExp(this.acceptedTypes.replace(/\./g, '\\.') + '$'))) {
      this.error.emit('Invalid file type. Accepted types: ' + this.acceptedTypes);
      return;
    }

    if (file.size > this.maxSize) {
      this.error.emit('File size exceeds maximum limit of ' + (this.maxSize / 1024 / 1024) + 'MB');
      return;
    }

    this.selectedFile = file;
    this.fileSelected.emit(file);
  }
}
