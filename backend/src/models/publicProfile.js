const mongoose = require('mongoose');

const publicSkillSchema = new mongoose.Schema({
  name: { type: String, required: true },
  score: { type: Number, default: 0 }
}, { _id: false });

const publicProjectSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String, default: '' },
  url: { type: String, default: '' },
  repoUrl: { type: String, default: '' },
  imageUrl: { type: String, default: '' },
  tech: [{ type: String }],
  status: {
    type: String,
    enum: ['completed', 'in-progress', 'upcoming', 'planned'],
    default: 'completed'
  },
  expectedDate: { type: String, default: '' }
}, { _id: false });

const publicUpcomingProjectSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String, default: '' },
  expectedDate: { type: String, default: '' },
  techStack: [{ type: String }],
  status: {
    type: String,
    enum: ['in-progress', 'planned'],
    default: 'planned'
  },
  url: { type: String, default: '' },
  repoUrl: { type: String, default: '' },
  imageUrl: { type: String, default: '' }
}, { _id: false });

const publicTestimonialSchema = new mongoose.Schema({
  quote: { type: String, required: true },
  name: { type: String, required: true },
  role: { type: String, default: '' },
  avatarUrl: { type: String, default: '' }
}, { _id: false });

const publicWorkExperienceSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String, default: '' },
  icon: { type: String, default: '' },
  ctaLabel: { type: String, default: '' },
  ctaUrl: { type: String, default: '' }
}, { _id: false });

const publicHeroSectionSchema = new mongoose.Schema({
  greetingLabel: { type: String, default: '' },
  roleLabel: { type: String, default: '' },
  titleLineOne: { type: String, default: '' },
  titleLineTwo: { type: String, default: '' },
  titleHighlight: { type: String, default: '' },
  titleLineSuffix: { type: String, default: '' },
  tagline: { type: String, default: '' }
}, { _id: false });

const publicSkillsSectionSchema = new mongoose.Schema({
  headline: { type: String, default: '' },
  highlight: { type: String, default: '' },
  headlineSuffix: { type: String, default: '' },
  subheadline: { type: String, default: '' }
}, { _id: false });

const publicContactSectionSchema = new mongoose.Schema({
  heading: { type: String, default: '' },
  message: { type: String, default: '' },
  email: { type: String, default: '' }
}, { _id: false });

const publicUpcomingSectionSchema = new mongoose.Schema({
  heading: { type: String, default: '' },
  subheading: { type: String, default: '' }
}, { _id: false });

const publicTestimonialsSectionSchema = new mongoose.Schema({
  heading: { type: String, default: '' },
  subheading: { type: String, default: '' }
}, { _id: false });

const publicCtaSectionSchema = new mongoose.Schema({
  heading: { type: String, default: '' },
  subtext: { type: String, default: '' },
  primaryLabel: { type: String, default: '' },
  secondaryLabel: { type: String, default: '' },
  resumeUrl: { type: String, default: '' }
}, { _id: false });

const publicSectionVisibilitySchema = new mongoose.Schema({
  projects: { type: Boolean, default: true },
  upcoming: { type: Boolean, default: true },
  testimonials: { type: Boolean, default: true },
  cta: { type: Boolean, default: true }
}, { _id: false });

const publicSectionCopySchema = new mongoose.Schema({
  hero: { type: publicHeroSectionSchema, default: () => ({}) },
  skills: { type: publicSkillsSectionSchema, default: () => ({}) },
  contact: { type: publicContactSectionSchema, default: () => ({}) },
  upcoming: { type: publicUpcomingSectionSchema, default: () => ({}) },
  testimonials: { type: publicTestimonialsSectionSchema, default: () => ({}) },
  cta: { type: publicCtaSectionSchema, default: () => ({}) },
  visibility: { type: publicSectionVisibilitySchema, default: () => ({}) }
}, { _id: false });

const publicProfileSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  slug: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  isPublic: {
    type: Boolean,
    default: false
  },
  headline: {
    type: String,
    default: ''
  },
  summary: {
    type: String,
    default: ''
  },
  skills: [publicSkillSchema],
  projects: [publicProjectSchema],
  upcomingProjects: [publicUpcomingProjectSchema],
  testimonials: [publicTestimonialSchema],
  workExperiences: [publicWorkExperienceSchema],
  sections: {
    type: publicSectionCopySchema,
    default: () => ({})
  },
  seoTitle: {
    type: String,
    default: ''
  },
  seoDescription: {
    type: String,
    default: ''
  },
  socialLinks: {
    website: { type: String, default: '' },
    twitter: { type: String, default: '' },
    linkedin: { type: String, default: '' },
    github: { type: String, default: '' }
  },
  totalViews: {
    type: Number,
    default: 0
  },
  uniqueViews: {
    type: Number,
    default: 0
  },
  lastViewedAt: {
    type: Date,
    default: null
  }
}, { timestamps: true });

module.exports = mongoose.model('PublicProfile', publicProfileSchema);
