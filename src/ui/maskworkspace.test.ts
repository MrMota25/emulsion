// SPDX-License-Identifier: GPL-3.0-or-later
// @vitest-environment happy-dom
import { beforeEach, expect, it } from 'vitest';
import { defaultRecipe } from '../film/recipe';
import { newGradient, newMask } from '../film/masks';
import { defaultControlWorkspace, saveControlWorkspace, useControlWorkspace, workspaceSection } from './controlworkspace';
import { closeTemporaryMasks, useTemporaryMasks, workspaceMasksOpen, workspaceMaskToolActive } from './maskworkspace';
import { setMaskUi, useMaskUi } from './maskui';
import { chooseTool, useTools } from './tools';
import { setWorkspace, useWorkspace } from './workspace';
import { omittedWorkspaceControls, resetWorkspaceControls } from './workspacecontrols';

beforeEach(() => {
  closeTemporaryMasks();
  setMaskUi({ selected: null, shape: null, tool: null, pick: null });
  useTools.setState({ beforeMask: 'develop', pointer: 'select', transform: false });
  const layout = defaultControlWorkspace();
  layout.groups[0].sections = [workspaceSection('exposure')];
  saveControlWorkspace(layout);
  setWorkspace({ group: 'custom' });
});

it.each(['omitted', 'hidden'] as const)('opens temporary Masks when %s, preserving the workspace and saved layout', state => {
  const layout = structuredClone(useControlWorkspace.getState());
  if (state === 'hidden') layout.groups[0].sections.push({ ...workspaceSection('masks'), controls: [] });
  saveControlWorkspace(layout);
  const stored = localStorage.getItem('emulsion.control-workspace');
  chooseTool('mask');
  expect(useWorkspace.getState().group).toBe('custom');
  expect(useTemporaryMasks.getState().open).toBe(true);
  expect(workspaceMasksOpen()).toBe(true);
  expect(workspaceMaskToolActive()).toBe(true);
  expect(localStorage.getItem('emulsion.control-workspace')).toBe(stored);
  chooseTool('mask');
  expect(useTemporaryMasks.getState().open).toBe(false);
  expect(workspaceMasksOpen()).toBe(false);
  expect(useControlWorkspace.getState()).toEqual(layout);
});

it('routes to the existing personal Masks tab and restores the previous tab when the tool is put down', () => {
  const layout = structuredClone(useControlWorkspace.getState());
  layout.groups.push({ id: 'local', name: 'Local edits', icon: 'layers', sections: [workspaceSection('masks')] });
  saveControlWorkspace(layout);
  chooseTool('mask');
  expect(useControlWorkspace.getState().active).toBe('local');
  expect(useWorkspace.getState().group).toBe('custom');
  expect(workspaceMasksOpen()).toBe(true);
  setMaskUi({ tool: { kind: 'gradient', mode: 'new' } });
  chooseTool('select');
  expect(useControlWorkspace.getState().active).toBe(layout.active);
  expect(workspaceMasksOpen()).toBe(false);
  expect(useMaskUi.getState().tool).toBeNull();
});

it('keeps Select and Pan available on a mixed tab containing Masks', () => {
  const layout = structuredClone(useControlWorkspace.getState());
  layout.groups[0].sections.push(workspaceSection('masks'));
  saveControlWorkspace(layout);
  expect(workspaceMasksOpen()).toBe(true);
  expect(workspaceMaskToolActive()).toBe(false);
  setMaskUi({ selected: 'mask', tool: { kind: 'brush', mode: 'new' } });
  expect(workspaceMaskToolActive()).toBe(true);
  chooseTool('pan');
  expect(workspaceMaskToolActive()).toBe(false);
  expect(useMaskUi.getState().tool).toBeNull();
  expect(useTools.getState().pointer).toBe('pan');
});

it('closes temporary Masks on tab changes and workspace switches, retaining independent preferences', () => {
  chooseTool('mask');
  setWorkspace({ imageColumns: 1 });
  expect(useTemporaryMasks.getState().open).toBe(true);
  saveControlWorkspace(useControlWorkspace.getState());
  expect(useTemporaryMasks.getState().open).toBe(false);
  chooseTool('mask');
  setWorkspace({ group: 'develop' });
  expect(useTemporaryMasks.getState().open).toBe(false);
  expect(workspaceMasksOpen()).toBe(false);
});

it('offers omitted masks and resets them without affecting global adjustments', () => {
  const recipe = { ...defaultRecipe(), exposure: 1.5, masks: [newMask(newGradient(), 0)] };
  expect(omittedWorkspaceControls(recipe, ['exposure'], { white: null }).map(d => d.id)).toContain('masks');
  expect(omittedWorkspaceControls(recipe, ['exposure', 'masks'], { white: null })).toEqual([]);
  expect(resetWorkspaceControls(recipe, ['masks'], { white: null })).toEqual({ ...recipe, masks: [] });
  expect(recipe.masks).toHaveLength(1);
});
