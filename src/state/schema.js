import { z } from 'zod';

export const ElementSchema = z.object({
  id: z.string(),
  tag: z.string(),
  classes: z.array(z.string()).default([]),
  attributes: z.record(z.string()).default({}),
  textContent: z.string().nullable().default(null),
  children: z.array(z.string()).default([]),
  parentId: z.string().nullable().default(null),
  pageId: z.string(),
});

export const ViewportSchema = z.object({
  device: z.string().default('desktop'),
  width: z.number().default(1440),
  height: z.number().default(900),
});

export const DESIGN_TYPES = ['responsive-web', 'mobile-app', 'tablet-app', 'desktop-app'];

export const ProjectSchema = z.object({
  name: z.string().default('Untitled Design'),
  activePageId: z.string(),
  viewport: ViewportSchema,
  designType: z.enum(DESIGN_TYPES).default('responsive-web'),
});

export const PageSchema = z.object({
  id: z.string(),
  name: z.string(),
  rootId: z.string(),
  styles: z.record(z.record(z.string())).default({}),
});

export const DesignTokensSchema = z.object({
  colors: z.record(z.string()).default({}),
  fonts: z.record(z.string()).default({}),
  spacing: z.record(z.string()).default({}),
});

export const DesignStateSchema = z.object({
  project: ProjectSchema,
  pages: z.record(PageSchema),
  elements: z.record(ElementSchema),
  styles: z.record(z.record(z.string())).default({}),
  designTokens: DesignTokensSchema.default({}),
});

export function createDefaultState() {
  return {
    project: {
      name: 'Untitled Design',
      activePageId: 'page-1',
      viewport: { device: 'desktop', width: 1440, height: 900 },
      designType: 'responsive-web',
    },
    pages: {
      'page-1': {
        id: 'page-1',
        name: 'Home',
        rootId: 'root-1',
        styles: {},
      },
    },
    elements: {
      'root-1': {
        id: 'root-1',
        tag: 'div',
        classes: ['page-root'],
        attributes: {},
        textContent: null,
        children: [],
        parentId: null,
        pageId: 'page-1',
      },
    },
    styles: {
      '.page-root': {
        'min-height': '100vh',
        position: 'relative',
      },
    },
    designTokens: {
      colors: {},
      fonts: {},
      spacing: {},
    },
  };
}
