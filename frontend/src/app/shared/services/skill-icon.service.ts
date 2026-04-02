import { Injectable } from '@angular/core';

export interface SkillIcon {
  mdiIcon: string;
  color: string;
  displayName: string;
}

@Injectable({
  providedIn: 'root'
})
export class SkillIconService {
  private readonly iconMap = new Map<string, SkillIcon>([
    // Frontend Frameworks & Libraries
    ['react', { mdiIcon: 'mdi-react', color: '#61DAFB', displayName: 'React' }],
    ['angular', { mdiIcon: 'mdi-angular', color: '#DD0031', displayName: 'Angular' }],
    ['vue', { mdiIcon: 'mdi-vuejs', color: '#4FC08D', displayName: 'Vue.js' }],
    ['next.js', { mdiIcon: 'mdi-nextjs', color: '#000000', displayName: 'Next.js' }],
    ['nextjs', { mdiIcon: 'mdi-nextjs', color: '#000000', displayName: 'Next.js' }],
    ['svelte', { mdiIcon: 'mdi-svelte', color: '#FF3E00', displayName: 'Svelte' }],
    
    // Backend & Runtime
    ['node.js', { mdiIcon: 'mdi-nodejs', color: '#339933', displayName: 'Node.js' }],
    ['nodejs', { mdiIcon: 'mdi-nodejs', color: '#339933', displayName: 'Node.js' }],
    ['node', { mdiIcon: 'mdi-nodejs', color: '#339933', displayName: 'Node.js' }],
    ['express', { mdiIcon: 'mdi-nodejs', color: '#000000', displayName: 'Express' }],
    ['nestjs', { mdiIcon: 'mdi-nest', color: '#E0234E', displayName: 'NestJS' }],
    ['deno', { mdiIcon: 'mdi-nodejs', color: '#000000', displayName: 'Deno' }],
    
    // Languages
    ['javascript', { mdiIcon: 'mdi-language-javascript', color: '#F7DF1E', displayName: 'JavaScript' }],
    ['typescript', { mdiIcon: 'mdi-language-typescript', color: '#3178C6', displayName: 'TypeScript' }],
    ['python', { mdiIcon: 'mdi-language-python', color: '#3776AB', displayName: 'Python' }],
    ['java', { mdiIcon: 'mdi-language-java', color: '#007396', displayName: 'Java' }],
    ['c++', { mdiIcon: 'mdi-language-cpp', color: '#00599C', displayName: 'C++' }],
    ['c#', { mdiIcon: 'mdi-language-csharp', color: '#239120', displayName: 'C#' }],
    ['csharp', { mdiIcon: 'mdi-language-csharp', color: '#239120', displayName: 'C#' }],
    ['c', { mdiIcon: 'mdi-language-c', color: '#A8B9CC', displayName: 'C' }],
    ['go', { mdiIcon: 'mdi-language-go', color: '#00ADD8', displayName: 'Go' }],
    ['rust', { mdiIcon: 'mdi-language-rust', color: '#000000', displayName: 'Rust' }],
    ['php', { mdiIcon: 'mdi-language-php', color: '#777BB4', displayName: 'PHP' }],
    ['ruby', { mdiIcon: 'mdi-language-ruby', color: '#CC342D', displayName: 'Ruby' }],
    ['swift', { mdiIcon: 'mdi-language-swift', color: '#FA7343', displayName: 'Swift' }],
    ['kotlin', { mdiIcon: 'mdi-language-kotlin', color: '#7F52FF', displayName: 'Kotlin' }],
    
    // Databases
    ['mongodb', { mdiIcon: 'mdi-database', color: '#47A248', displayName: 'MongoDB' }],
    ['postgresql', { mdiIcon: 'mdi-database', color: '#336791', displayName: 'PostgreSQL' }],
    ['mysql', { mdiIcon: 'mdi-database', color: '#4479A1', displayName: 'MySQL' }],
    ['redis', { mdiIcon: 'mdi-database', color: '#DC382D', displayName: 'Redis' }],
    ['sqlite', { mdiIcon: 'mdi-database', color: '#003B57', displayName: 'SQLite' }],
    ['firebase', { mdiIcon: 'mdi-firebase', color: '#FFCA28', displayName: 'Firebase' }],
    
    // State Management
    ['redux', { mdiIcon: 'mdi-redux', color: '#764ABC', displayName: 'Redux' }],
    ['mobx', { mdiIcon: 'mdi-state-machine', color: '#FF9955', displayName: 'MobX' }],
    ['vuex', { mdiIcon: 'mdi-vuejs', color: '#4FC08D', displayName: 'Vuex' }],
    
    // CSS & Styling
    ['css', { mdiIcon: 'mdi-language-css3', color: '#1572B6', displayName: 'CSS' }],
    ['css3', { mdiIcon: 'mdi-language-css3', color: '#1572B6', displayName: 'CSS3' }],
    ['html', { mdiIcon: 'mdi-language-html5', color: '#E34F26', displayName: 'HTML' }],
    ['html5', { mdiIcon: 'mdi-language-html5', color: '#E34F26', displayName: 'HTML5' }],
    ['sass', { mdiIcon: 'mdi-sass', color: '#CC6699', displayName: 'Sass' }],
    ['scss', { mdiIcon: 'mdi-sass', color: '#CC6699', displayName: 'SCSS' }],
    ['tailwind', { mdiIcon: 'mdi-tailwind', color: '#06B6D4', displayName: 'Tailwind CSS' }],
    ['bootstrap', { mdiIcon: 'mdi-bootstrap', color: '#7952B3', displayName: 'Bootstrap' }],
    
    // Design Tools
    ['figma', { mdiIcon: 'mdi-draw', color: '#F24E1E', displayName: 'Figma' }],
    ['adobe xd', { mdiIcon: 'mdi-adobe', color: '#FF61F6', displayName: 'Adobe XD' }],
    ['xd', { mdiIcon: 'mdi-adobe', color: '#FF61F6', displayName: 'Adobe XD' }],
    ['sketch', { mdiIcon: 'mdi-draw', color: '#F7B500', displayName: 'Sketch' }],
    ['illustrator', { mdiIcon: 'mdi-adobe', color: '#FF9A00', displayName: 'Illustrator' }],
    ['photoshop', { mdiIcon: 'mdi-adobe', color: '#31A8FF', displayName: 'Photoshop' }],
    
    // DevOps & Cloud
    ['docker', { mdiIcon: 'mdi-docker', color: '#2496ED', displayName: 'Docker' }],
    ['kubernetes', { mdiIcon: 'mdi-kubernetes', color: '#326CE5', displayName: 'Kubernetes' }],
    ['aws', { mdiIcon: 'mdi-aws', color: '#FF9900', displayName: 'AWS' }],
    ['azure', { mdiIcon: 'mdi-microsoft-azure', color: '#0078D4', displayName: 'Azure' }],
    ['gcp', { mdiIcon: 'mdi-google-cloud', color: '#4285F4', displayName: 'GCP' }],
    ['git', { mdiIcon: 'mdi-git', color: '#F05032', displayName: 'Git' }],
    ['github', { mdiIcon: 'mdi-github', color: '#181717', displayName: 'GitHub' }],
    ['gitlab', { mdiIcon: 'mdi-gitlab', color: '#FC6D26', displayName: 'GitLab' }],
    
    // Testing
    ['jest', { mdiIcon: 'mdi-test-tube', color: '#C21325', displayName: 'Jest' }],
    ['mocha', { mdiIcon: 'mdi-test-tube', color: '#8D6748', displayName: 'Mocha' }],
    ['cypress', { mdiIcon: 'mdi-test-tube', color: '#17202C', displayName: 'Cypress' }],
    ['selenium', { mdiIcon: 'mdi-test-tube', color: '#43B02A', displayName: 'Selenium' }],
    
    // Tools & Others
    ['webpack', { mdiIcon: 'mdi-webpack', color: '#8DD6F9', displayName: 'Webpack' }],
    ['vite', { mdiIcon: 'mdi-lightning-bolt', color: '#646CFF', displayName: 'Vite' }],
    ['graphql', { mdiIcon: 'mdi-graphql', color: '#E10098', displayName: 'GraphQL' }],
    ['rest api', { mdiIcon: 'mdi-api', color: '#6DB33F', displayName: 'REST API' }],
    ['api', { mdiIcon: 'mdi-api', color: '#6DB33F', displayName: 'API' }],
  ]);

  getSkillIcon(skillName: string): SkillIcon {
    const normalized = skillName.toLowerCase().trim();
    const found = this.iconMap.get(normalized);
    
    if (found) {
      return found;
    }

    // Fallback icon based on common patterns
    if (normalized.includes('js')) {
      return { mdiIcon: 'mdi-language-javascript', color: '#F7DF1E', displayName: skillName };
    }
    if (normalized.includes('database') || normalized.includes('db')) {
      return { mdiIcon: 'mdi-database', color: '#4479A1', displayName: skillName };
    }
    if (normalized.includes('design')) {
      return { mdiIcon: 'mdi-draw', color: '#F24E1E', displayName: skillName };
    }
    if (normalized.includes('cloud')) {
      return { mdiIcon: 'mdi-cloud', color: '#4285F4', displayName: skillName };
    }

    // Default fallback
    return { 
      mdiIcon: 'mdi-code-braces', 
      color: '#9857D3', 
      displayName: skillName 
    };
  }

  getAllIconsForSkills(skills: Array<{ name: string }>): SkillIcon[] {
    return skills.map(skill => this.getSkillIcon(skill.name));
  }
}
