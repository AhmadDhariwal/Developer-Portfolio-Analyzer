import { Injectable } from '@angular/core';
import { map, Observable, Subject, takeUntil, distinctUntilChanged } from 'rxjs';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';
import {
  ScenarioContext,
  ScenarioInput,
  SavedScenario,
  SimResult,
} from '../models/scenario-simulator.model';

@Injectable({ providedIn: 'root' })
export class ScenarioSimulatorService {
  readonly sessionChanged$ = new Subject<void>();
  constructor(
    private readonly api: ApiService,
    auth: AuthService,
  ) {
    auth.currentUser$
      .pipe(
        map((user) => user?._id || null),
        distinctUntilChanged(),
      )
      .subscribe(() => {
        this.sessionChanged$.next();
        this.api.clearScenarioCaches();
      });
  }
  getScenarioSimulatorContext(
    refresh = false,
    signature = '',
  ): Observable<{ context: ScenarioContext; frontendCacheHit?: boolean }> {
    return this.api
      .getScenarioSimulatorContext(refresh, signature)
      .pipe(takeUntil(this.sessionChanged$));
  }
  getScenarioSimulationHistory(
    limit = 8,
    refresh = false,
    signature = '',
    cursor = '',
  ): Observable<{
    history: SavedScenario[];
    nextCursor?: string | null;
    cache?: { hit: boolean };
    frontendCacheHit?: boolean;
  }> {
    return this.api
      .getScenarioSimulationHistory(limit, refresh, signature, cursor)
      .pipe(takeUntil(this.sessionChanged$));
  }
  runWhatIfSimulation(payload: ScenarioInput): Observable<{ result: SimResult }> {
    return this.api.runWhatIfSimulation(payload).pipe(takeUntil(this.sessionChanged$));
  }
  saveScenarioSimulation(payload: ScenarioInput): Observable<{ scenario: SavedScenario }> {
    return this.api.saveScenarioSimulation(payload).pipe(takeUntil(this.sessionChanged$));
  }
  deleteScenarioSimulation(id: string): Observable<unknown> {
    return this.api.deleteScenarioSimulation(id).pipe(takeUntil(this.sessionChanged$));
  }
  createSprintFromScenario(payload: ScenarioInput): Observable<{
    message: string;
    sprint: { tasksCreated?: number; tasksMerged?: number; tasksSkipped?: number };
  }> {
    return this.api.createSprintFromScenario(payload).pipe(takeUntil(this.sessionChanged$));
  }
  invalidateScenarioContextCache(): void {
    this.api.invalidateScenarioContextCache();
  }
}
