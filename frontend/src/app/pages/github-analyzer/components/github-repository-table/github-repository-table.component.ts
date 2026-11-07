import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import {
  UiBadgeComponent,
  UiButtonComponent,
  UiProgressComponent,
} from '../../../../shared/components';
import { Repository } from '../../../../shared/services/github.service';
import { GithubPresentation } from '../../github-presentation';
@Component({
  selector: 'app-github-repository-table',
  standalone: true,
  imports: [CommonModule, UiButtonComponent, UiBadgeComponent, UiProgressComponent],
  templateUrl: './github-repository-table.component.html',
  styleUrl: './github-repository-table.component.scss',
})
export class GithubRepositoryTableComponent extends GithubPresentation {
  @Input({ required: true }) repositoryRows!: Repository[];
  @Input({ required: true }) showAllRepositories!: boolean;
  @Input({ required: true }) repoSortField!: 'score' | 'stars' | 'name';
  @Input({ required: true }) repoSortAsc!: boolean;
  @Input({ required: true }) sortedRepositoryRows!: Repository[];
  @Input({ required: true }) viewedUsername!: string;
  @Input({ required: true }) username!: string;
  @Output() readonly showAllRequested = new EventEmitter<void>();
  @Output() readonly sortRequested = new EventEmitter<'score' | 'stars' | 'name'>();
}
