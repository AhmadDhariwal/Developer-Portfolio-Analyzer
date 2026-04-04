import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';
import { PublicProfileTestimonial } from '../../../../shared/services/public-profile.service';

@Component({
  selector: 'app-testimonial-card',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './testimonial-card.component.html',
  styleUrl: './testimonial-card.component.scss'
})
export class TestimonialCardComponent {
  @Input({ required: true }) testimonial!: PublicProfileTestimonial;

  get hasAvatar(): boolean {
    return Boolean(this.testimonial.avatarUrl);
  }
}
