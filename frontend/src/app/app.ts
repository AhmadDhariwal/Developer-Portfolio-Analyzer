import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet } from '@angular/router';
import { MaintenanceModalComponent } from './shared/components/maintenance-modal/maintenance-modal.component';
import { MaintenanceModeService } from './shared/services/maintenance-mode.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterOutlet, MaintenanceModalComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})

export class App {
  constructor(public readonly maintenanceMode: MaintenanceModeService) {}
}

