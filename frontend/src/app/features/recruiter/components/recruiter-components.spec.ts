import { Location } from '@angular/common';
import { SimpleChange } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { describe, expect, it, vi } from 'vitest';
import { ActivityTimelineComponent } from './activity-timeline/activity-timeline.component';
import { CandidateCardComponent } from './candidate-card/candidate-card.component';
import { ComparisonTableComponent } from './comparison-table/comparison-table.component';
import { EmptyStateComponent } from './empty-state/empty-state.component';
import { JobCardComponent } from './job-card/job-card.component';
import { LoaderComponent } from './loader/loader.component';
import { MatchCardComponent } from './match-card/match-card.component';
import { RecruiterBackButtonComponent } from './recruiter-back-button/recruiter-back-button.component';
import { RecruiterPerformanceChartComponent } from './recruiter-performance-chart/recruiter-performance-chart.component';
import { RecruiterStatCardComponent } from './recruiter-stat-card/recruiter-stat-card.component';
import { ShortlistCardComponent } from './shortlist-card/shortlist-card.component';

describe('Recruiter standalone UI components', () => {
  it('renders CandidateCardComponent initials, score tones, and emits actions', () => {
    TestBed.configureTestingModule({ imports: [CandidateCardComponent] });
    const fixture: ComponentFixture<CandidateCardComponent> =
      TestBed.createComponent(CandidateCardComponent);
    const component = fixture.componentInstance;
    component.candidate = { id: 'c1', name: 'Aliya Dev', readinessScore: 84, stack: 'Full Stack' };
    fixture.detectChanges();

    expect(component.initial).toBe('A');
    expect(component.scoreToneClass).toContain('--high');

    component.candidate = { id: 'c2', fullName: 'bilal', score: 68 };
    expect(component.initial).toBe('B');
    expect(component.scoreToneClass).toContain('--mid');

    component.candidate = { id: 'c3', score: 40 };
    expect(component.initial).toBe('C');
    expect(component.scoreToneClass).toContain('--low');

    const viewSpy = vi.fn();
    component.view.subscribe(viewSpy);
    component.view.emit(component.candidate);
    expect(viewSpy).toHaveBeenCalledWith(component.candidate);
    fixture.componentRef.setInput('candidate', {
      readinessScore: null,
      githubScore: null,
      resumeScore: null,
    });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Readiness unavailable');
    expect(fixture.nativeElement.querySelectorAll('.unavailable-pill').length).toBe(3);
    fixture.componentRef.setInput('candidate', {
      readinessScore: 0,
      githubScore: 0,
      resumeScore: 0,
    });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.unavailable-pill').length).toBe(0);
  });

  it('renders JobCardComponent, ShortlistCardComponent, and MatchCardComponent status helpers', () => {
    TestBed.configureTestingModule({
      imports: [JobCardComponent, MatchCardComponent, ShortlistCardComponent],
    });

    const jobFixture = TestBed.createComponent(JobCardComponent);
    jobFixture.componentInstance.job = { _id: 'j1', title: 'Staff Engineer', status: 'open' };
    jobFixture.detectChanges();
    expect(jobFixture.nativeElement.textContent).toContain('Staff Engineer');

    const matchFixture = TestBed.createComponent(MatchCardComponent);
    matchFixture.componentInstance.match = { _id: 'm1', status: 'SHORTLISTED', matchScore: 91 };
    expect(matchFixture.componentInstance.isShortlisted).toBe(true);
    expect(matchFixture.componentInstance.isRejected).toBe(false);
    matchFixture.componentInstance.match = { _id: 'm2', status: 'rejected' };
    expect(matchFixture.componentInstance.isRejected).toBe(true);

    const shortlistFixture = TestBed.createComponent(ShortlistCardComponent);
    shortlistFixture.componentInstance.item = {
      _id: 's1',
      status: 'reviewing',
      candidate: { name: 'Aliya' },
    };
    shortlistFixture.detectChanges();
    expect(shortlistFixture.nativeElement.textContent).toContain('Aliya');
  });

  it('computes ComparisonTableComponent best metrics and optional match row', () => {
    TestBed.configureTestingModule({ imports: [ComparisonTableComponent] });
    const fixture = TestBed.createComponent(ComparisonTableComponent);
    const component = fixture.componentInstance;
    component.items = [
      { readinessScore: 72, match: { matchScore: 78 } },
      { readinessScore: 88, match: { matchScore: 93 } },
    ];
    fixture.detectChanges();

    expect(component.hasMatchRow).toBe(true);
    expect(component.isBest('readinessScore', 88)).toBe(true);
    expect(component.isBest('readinessScore', 72)).toBe(false);
    expect(component.isBest('matchScore', 93)).toBe(true);
  });

  it('handles RecruiterStatCardComponent, EmptyStateComponent, and LoaderComponent', () => {
    TestBed.configureTestingModule({
      imports: [RecruiterStatCardComponent, EmptyStateComponent, LoaderComponent],
    });

    const stat = TestBed.createComponent(RecruiterStatCardComponent);
    stat.componentInstance.label = 'Open Jobs';
    stat.componentInstance.value = 14;
    stat.componentInstance.ngOnChanges({
      value: new SimpleChange<string | number>('', 14, true),
    });
    stat.detectChanges();
    expect(stat.componentInstance.displayValue).toBe(14);
    expect(stat.nativeElement.textContent).toContain('Open Jobs');

    const empty = TestBed.createComponent(EmptyStateComponent);
    empty.componentInstance.title = 'Empty Queue';
    empty.detectChanges();
    expect(empty.nativeElement.textContent).toContain('Empty Queue');

    const loader = TestBed.createComponent(LoaderComponent);
    loader.componentInstance.count = 0;
    expect(loader.componentInstance.items).toEqual([0]);
    loader.componentInstance.count = 4;
    expect(loader.componentInstance.items.length).toBe(4);
    expect(loader.componentInstance.trackByIndex(2)).toBe(2);
  });

  it('renders RecruiterPerformanceChartComponent modes and ActivityTimelineComponent formatting', () => {
    TestBed.configureTestingModule({
      imports: [RecruiterPerformanceChartComponent, ActivityTimelineComponent],
    });

    const chart = TestBed.createComponent(RecruiterPerformanceChartComponent);
    chart.componentInstance.items = [
      { label: 'Node.js', supply: 8, demand: 12 },
      { label: 'MongoDB', count: 5 },
    ];
    expect(chart.componentInstance.resolvedMode).toBe('dual');
    expect(chart.componentInstance.totalValue).toBe(5);
    expect(chart.componentInstance.donutGradient).toContain('conic-gradient');
    chart.componentInstance.mode = 'gauge';
    chart.componentInstance.items = [{ label: 'Success', value: 76 }];
    expect(chart.componentInstance.gaugeValue).toBe(76);
    expect(chart.componentInstance.gaugeGradient).toContain('76%');

    const timeline = TestBed.createComponent(ActivityTimelineComponent);
    expect(timeline.componentInstance.labelFor('RECRUITER_JOB_CREATED')).toBe('Job Created');
    expect(timeline.componentInstance.labelFor('')).toBe('Activity');
    expect(timeline.componentInstance.trackByItem(0, { _id: 'a1' })).toBe('a1');
  });

  it('handles RecruiterBackButtonComponent history back and fallback route navigation', () => {
    const locationMock = { back: vi.fn() };
    TestBed.configureTestingModule({
      imports: [RecruiterBackButtonComponent],
      providers: [provideRouter([]), { provide: Location, useValue: locationMock }],
    });

    const router = TestBed.inject(Router);
    const navSpy = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    const fixture = TestBed.createComponent(RecruiterBackButtonComponent);
    const component = fixture.componentInstance;

    const historyLenSpy = vi.spyOn(window.history, 'length', 'get').mockReturnValue(3);
    component.goBack();
    expect(locationMock.back).toHaveBeenCalledTimes(1);

    historyLenSpy.mockReturnValue(1);
    component.fallbackRoute = '/app/recruiter/jobs';
    component.goBack();
    expect(navSpy).toHaveBeenCalledWith('/app/recruiter/jobs');
  });
});
