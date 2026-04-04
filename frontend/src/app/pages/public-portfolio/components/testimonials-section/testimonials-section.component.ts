import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';
import { PublicProfileTestimonial } from '../../../../shared/services/public-profile.service';
import { TestimonialCardComponent } from '../testimonial-card/testimonial-card.component';

@Component({
  selector: 'app-testimonials-section',
  standalone: true,
  imports: [CommonModule, TestimonialCardComponent],
  templateUrl: './testimonials-section.component.html',
  styleUrl: './testimonials-section.component.scss'
})
export class TestimonialsSectionComponent {
  @Input() heading = 'Testimonials';
  @Input() subheading = '';
  @Input() testimonials: PublicProfileTestimonial[] = [];
}
