import { Component, Output, EventEmitter, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-navbar',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './navbar.component.html',
  styleUrl: './navbar.component.scss'
})
export class NavbarComponent implements OnInit {
  @Output() toggleSidebar = new EventEmitter<void>();

  readonly userName: string = 'Developer';
  readonly notifications: number = 3;
  currentTime: Date = new Date();

  ngOnInit() {
    setInterval(() => {
      this.currentTime = new Date();
    }, 1000);
  }

  onToggleSidebar() {
    this.toggleSidebar.emit();
  }

  logout() {
    console.log('Logout clicked');
  }
}
