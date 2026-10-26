import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { IntegrationsMarketplaceComponent } from './integrations-marketplace.component';
import {
  IntegrationsService,
  IntegrationMarketplaceItem,
} from '../../shared/services/integrations.service';

const mockIntegrations: IntegrationMarketplaceItem[] = [
  {
    provider: 'github',
    name: 'GitHub',
    description: 'Sync repositories, contribution activity, and language signals.',
    category: 'Code Hosting',
    authMode: 'oauth2',
    status: 'connected',
    externalUsername: 'testdev',
    lastSyncedAt: '2026-10-26T10:00:00.000Z',
  },
  {
    provider: 'leetcode',
    name: 'LeetCode',
    description: 'Track coding challenge consistency and difficulty progress.',
    category: 'Practice Platform',
    authMode: 'manual',
    status: 'disconnected',
    externalUsername: '',
    lastSyncedAt: null,
  },
  {
    provider: 'linkedin',
    name: 'LinkedIn',
    description: 'Import headline, endorsements, and networking signals.',
    category: 'Professional Network',
    authMode: 'oauth2',
    status: 'disconnected',
    externalUsername: '',
    lastSyncedAt: null,
  },
  {
    provider: 'stackoverflow',
    name: 'Stack Overflow',
    description: 'Fetch reputation, badges, and top tags.',
    category: 'Developer Community',
    authMode: 'manual',
    status: 'disconnected',
    externalUsername: '',
    lastSyncedAt: null,
  },
];

describe('IntegrationsMarketplaceComponent', () => {
  const serviceMock = {
    getMarketplace: vi.fn(),
    getInsights: vi.fn(),
    startOAuth: vi.fn(),
    oauthCallback: vi.fn(),
    manualConnect: vi.fn(),
    ingest: vi.fn(),
    syncNow: vi.fn(),
    disconnect: vi.fn(),
  };

  beforeEach(() => {
    vi.resetAllMocks();
    serviceMock.getMarketplace.mockReturnValue(of({ integrations: mockIntegrations }));
    serviceMock.getInsights.mockReturnValue(
      of({
        integrationScore: 78,
        providers: [],
        mergedSkills: ['JavaScript', 'TypeScript', 'Node.js'],
      }),
    );
    serviceMock.syncNow.mockReturnValue(of({ success: true }));
    serviceMock.manualConnect.mockReturnValue(of({ success: true }));
    serviceMock.disconnect.mockReturnValue(of({ success: true }));

    TestBed.configureTestingModule({
      imports: [IntegrationsMarketplaceComponent],
      providers: [provideRouter([]), { provide: IntegrationsService, useValue: serviceMock }],
    });
  });

  function mount() {
    const fixture = TestBed.createComponent(IntegrationsMarketplaceComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('creates the component and loads initial telemetry and marketplace items', () => {
    const fixture = mount();
    const comp = fixture.componentInstance;
    expect(comp).toBeTruthy();
    expect(comp.integrations.length).toBe(4);
    expect(comp.connectedCount).toBe(1);
    expect(comp.disconnectedCount).toBe(3);
    expect(comp.integrationScore).toBe(78);
    expect(comp.getScoreHealthLabel(78)).toBe('Optimal');
  });

  it('filters integrations by active category tab', () => {
    const fixture = mount();
    const comp = fixture.componentInstance;

    // Default 'all'
    expect(comp.displayedIntegrations.length).toBe(4);

    // 'connected'
    comp.activeCategory = 'connected';
    expect(comp.displayedIntegrations.length).toBe(1);
    expect(comp.displayedIntegrations[0].provider).toBe('github');

    // 'algo'
    comp.activeCategory = 'algo';
    expect(comp.displayedIntegrations.length).toBe(1);
    expect(comp.displayedIntegrations[0].provider).toBe('leetcode');

    // 'community'
    comp.activeCategory = 'community';
    expect(comp.displayedIntegrations.length).toBe(2);
  });

  it('filters integrations by search query across name and description', () => {
    const fixture = mount();
    const comp = fixture.componentInstance;

    comp.searchQuery = 'LeetCode';
    expect(comp.displayedIntegrations.length).toBe(1);
    expect(comp.displayedIntegrations[0].name).toBe('LeetCode');

    comp.searchQuery = 'language signals';
    expect(comp.displayedIntegrations.length).toBe(1);
    expect(comp.displayedIntegrations[0].provider).toBe('github');

    comp.searchQuery = 'non-existent-keyword';
    expect(comp.displayedIntegrations.length).toBe(0);
  });

  it('triggers broadcast syncAll and refreshes telemetry', () => {
    const fixture = mount();
    const comp = fixture.componentInstance;

    comp.syncAll();
    expect(serviceMock.syncNow).toHaveBeenCalled();
    expect(serviceMock.getMarketplace).toHaveBeenCalledTimes(2);
    expect(serviceMock.getInsights).toHaveBeenCalledTimes(2);
  });

  it('validates manual username requirement before connecting', () => {
    const fixture = mount();
    const comp = fixture.componentInstance;

    const leetcodeItem = comp.integrations.find((item) => item.provider === 'leetcode')!;
    comp.manualUsername['leetcode'] = '';
    comp.manualConnect(leetcodeItem);

    expect(comp.errorMessage).toContain('LeetCode: LeetCode Username is required.');
    expect(serviceMock.manualConnect).not.toHaveBeenCalled();

    comp.manualUsername['leetcode'] = 'leetcode_hero';
    comp.manualConnect(leetcodeItem);
    expect(serviceMock.manualConnect).toHaveBeenCalledWith('leetcode', 'leetcode_hero', '');
  });

  it('disconnects a connected provider properly', () => {
    const fixture = mount();
    const comp = fixture.componentInstance;

    const githubItem = comp.integrations.find((item) => item.provider === 'github')!;
    comp.disconnect(githubItem);

    expect(serviceMock.disconnect).toHaveBeenCalledWith('github');
  });

  it('disables unavailable providers while retaining disconnect and independent Dev.to input', () => {
    const items: IntegrationMarketplaceItem[] = [
      { ...mockIntegrations[1], provider: 'kaggle', name: 'Kaggle' },
      { ...mockIntegrations[0], provider: 'hackerrank', name: 'HackerRank', authMode: 'manual' },
      { ...mockIntegrations[1], provider: 'devblogs', name: 'Dev.to' },
    ];
    serviceMock.getMarketplace.mockReturnValue(of({ integrations: items }));
    const fixture = mount();
    const comp = fixture.componentInstance;
    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelector('#input-kaggle')).toBeNull();
    expect(root.querySelector('#input-devblogs')?.getAttribute('placeholder')).toBe(
      'devto@your-handle',
    );
    expect(root.textContent).not.toContain('Dev.to or Hashnode');
    expect(root.querySelector<HTMLButtonElement>('.connect-btn')?.disabled).toBe(true);
    expect(root.querySelector<HTMLButtonElement>('.sync-btn')?.disabled).toBe(true);
    expect(root.querySelector<HTMLButtonElement>('.disconnect-btn')?.disabled).toBe(false);
    expect(root.textContent?.match(/Unavailable/g)?.length).toBe(2);
    comp.connect(items[0]);
    comp.manualConnect(items[0]);
    comp.runIngestion('hackerrank');
    expect(serviceMock.manualConnect).not.toHaveBeenCalled();
    expect(serviceMock.syncNow).not.toHaveBeenCalled();
    comp.manualUsername.devblogs = 'devto@swyx';
    comp.manualConnect(items[2]);
    expect(serviceMock.manualConnect).toHaveBeenCalledWith('devblogs', 'devto@swyx', '');
    comp.disconnect(items[1]);
    expect(serviceMock.disconnect).toHaveBeenCalledWith('hackerrank');
  });

  it('toggles terminal drawer and maintains logs', () => {
    const fixture = mount();
    const comp = fixture.componentInstance;

    expect(comp.isTerminalOpen).toBe(false);
    comp.toggleTerminal();
    expect(comp.isTerminalOpen).toBe(true);
    expect(comp.terminalLogs.length).toBeGreaterThan(0);
  });
});
