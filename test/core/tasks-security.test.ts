import { describe, it, expect, beforeEach } from 'vitest';
import { TasksPlugin } from '../../plugins/tasks';

describe('TasksPlugin Security Validation', () => {
  let plugin: TasksPlugin;

  beforeEach(() => {
    plugin = new TasksPlugin({
      id: 'tasks',
      name: 'Tasks',
      type: 'api-connection',
      capabilities: [],
    } as any);
  });

  it('allows creating a valid task', async () => {
    const task = await plugin.create('Valid task title', {
      description: 'A valid description',
      priority: 'high',
      tags: ['work', 'urgent'],
    });

    expect(task.title).toBe('Valid task title');
    expect(task.priority).toBe('high');
    expect(task.tags).toEqual(['work', 'urgent']);
  });

  it('rejects invalid title types or empty title strings', async () => {
    await expect(plugin.create('' as any)).rejects.toThrowError('Security Error: Invalid task title.');
    await expect(plugin.create('   ' as any)).rejects.toThrowError('Security Error: Invalid task title.');
    await expect(plugin.create(123 as any)).rejects.toThrowError('Security Error: Invalid task title.');
    await expect(plugin.create(null as any)).rejects.toThrowError('Security Error: Invalid task title.');
  });

  it('rejects oversized task titles', async () => {
    const longTitle = 'a'.repeat(201);
    await expect(plugin.create(longTitle)).rejects.toThrowError('Security Error: Invalid task title.');
  });

  it('rejects invalid descriptions and priorities in opts', async () => {
    const longDescription = 'd'.repeat(2001);
    await expect(plugin.create('Task', { description: longDescription })).rejects.toThrowError('Security Error: Invalid task description.');
    await expect(plugin.create('Task', { priority: 'critical' as any })).rejects.toThrowError('Security Error: Invalid task priority.');
  });

  it('rejects invalid tags in opts', async () => {
    await expect(plugin.create('Task', { tags: ['a'.repeat(51)] })).rejects.toThrowError('Security Error: Invalid task tags.');
    await expect(plugin.create('Task', { tags: [123 as any] })).rejects.toThrowError('Security Error: Invalid task tags.');
    await expect(plugin.create('Task', { tags: 'not-an-array' as any })).rejects.toThrowError('Security Error: Invalid task tags.');
  });

  it('validates filter parameters in list()', async () => {
    await expect(plugin.list({ priority: 'invalid' as any })).rejects.toThrowError('Security Error: Invalid filter priority.');
    await expect(plugin.list({ tag: 't'.repeat(51) })).rejects.toThrowError('Security Error: Invalid filter tag.');
  });

  it('validates task id on complete() and remove()', async () => {
    await expect(plugin.complete('')).rejects.toThrowError('Security Error: Invalid task ID.');
    await expect(plugin.complete('   ')).rejects.toThrowError('Security Error: Invalid task ID.');
    await expect(plugin.complete(123 as any)).rejects.toThrowError('Security Error: Invalid task ID.');
    await expect(plugin.complete('i'.repeat(101))).rejects.toThrowError('Security Error: Invalid task ID.');

    await expect(plugin.remove('')).rejects.toThrowError('Security Error: Invalid task ID.');
    await expect(plugin.remove('i'.repeat(101))).rejects.toThrowError('Security Error: Invalid task ID.');
  });

  it('completes and removes valid tasks', async () => {
    const task = await plugin.create('Task to complete and remove');
    const completed = await plugin.complete(task.id);
    expect(completed).toBe(true);

    const listAfterComplete = await plugin.list({ completed: true });
    expect(listAfterComplete.some((t) => t.id === task.id)).toBe(true);

    const removed = await plugin.remove(task.id);
    expect(removed).toBe(true);

    const listAfterRemove = await plugin.list();
    expect(listAfterRemove.some((t) => t.id === task.id)).toBe(false);
  });
});
