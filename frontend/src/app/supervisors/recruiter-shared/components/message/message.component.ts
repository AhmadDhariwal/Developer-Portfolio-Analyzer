import { Component } from '@angular/core';
import { RecruiterMessageService } from '../../services/recruiter-message.service';

@Component({
  selector: 'app-message',
  standalone: false,
  templateUrl: './message.component.html',
  styleUrls: ['./message.component.scss']
})
export class MessageComponent {
  constructor(public readonly messageService: RecruiterMessageService) {}

  dismiss(): void {
    this.messageService.clear();
  }
}
