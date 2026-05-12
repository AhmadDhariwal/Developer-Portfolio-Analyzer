import { ChangeDetectionStrategy, ChangeDetectorRef, Component, DestroyRef, EventEmitter, OnInit, Output, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { interval } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

@Component({
  selector: 'app-navbar',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './navbar.component.html',
  styleUrl: './navbar.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class NavbarComponent implements OnInit {
  @Output() toggleSidebar = new EventEmitter<void>();

  readonly userName: string = 'Developer';
  readonly notifications: number = 3;
  currentTime: Date = new Date();
  private readonly destroyRef = inject(DestroyRef);

  constructor(private readonly cdr: ChangeDetectorRef) {}

  ngOnInit() {
    interval(1000)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.currentTime = new Date();
        this.cdr.markForCheck();
      });
  }

  onToggleSidebar() {
    this.toggleSidebar.emit();
  }

  logout() {
    // Intentionally left blank (this component is presentational-only).
  }
}
