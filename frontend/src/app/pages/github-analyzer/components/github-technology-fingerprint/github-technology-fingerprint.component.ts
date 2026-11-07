import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';
import { TechnologySignal } from '../../../../shared/services/github.service';
import { GithubPresentation } from '../../github-presentation';
@Component({
  selector: 'app-github-technology-fingerprint',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './github-technology-fingerprint.component.html',
  styleUrl: './github-technology-fingerprint.component.scss',
})
export class GithubTechnologyFingerprintComponent extends GithubPresentation {
  @Input({ required: true }) hasTechnologyData!: boolean;
  @Input({ required: true }) technologyCategories!: {
    category: string;
    items: TechnologySignal[];
  }[];
}
