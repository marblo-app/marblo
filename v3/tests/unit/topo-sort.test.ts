import { describe, it, expect } from 'vitest';
import { topoSort, detectCycles, getOutgoingEdges, getIncomingEdges } from '../../electron/flow-engine/topo-sort';
import { makeNode, makeEdge } from '../setup';

describe('topoSort', () => {
  it('sorts a linear chain into sequential layers', () => {
    const nodes = [makeNode('a', 'input'), makeNode('b', 'llm'), makeNode('c', 'output')];
    const edges = [makeEdge('a', 'b'), makeEdge('b', 'c')];
    const layers = topoSort(nodes, edges);
    expect(layers).toEqual([['a'], ['b'], ['c']]);
  });

  it('groups independent nodes into the same layer', () => {
    const nodes = [
      makeNode('start', 'input'),
      makeNode('a', 'llm'),
      makeNode('b', 'api'),
      makeNode('end', 'output'),
    ];
    const edges = [makeEdge('start', 'a'), makeEdge('start', 'b'), makeEdge('a', 'end'), makeEdge('b', 'end')];
    const layers = topoSort(nodes, edges);

    expect(layers[0]).toEqual(['start']);
    expect(layers[1]).toHaveLength(2);
    expect(layers[1]).toContain('a');
    expect(layers[1]).toContain('b');
    expect(layers[2]).toEqual(['end']);
  });

  it('handles a single node', () => {
    const nodes = [makeNode('only', 'input')];
    const layers = topoSort(nodes, []);
    expect(layers).toEqual([['only']]);
  });

  it('handles disconnected nodes', () => {
    const nodes = [makeNode('a', 'input'), makeNode('b', 'llm'), makeNode('c', 'output')];
    const layers = topoSort(nodes, []);
    expect(layers).toHaveLength(1);
    expect(layers[0]).toHaveLength(3);
  });

  it('throws on cycles', () => {
    const nodes = [makeNode('a', 'input'), makeNode('b', 'llm'), makeNode('c', 'output')];
    const edges = [makeEdge('a', 'b'), makeEdge('b', 'c'), makeEdge('c', 'a')];
    expect(() => topoSort(nodes, edges)).toThrow(/cycles/i);
  });

  it('handles branch edges with sourceHandle', () => {
    const nodes = [
      makeNode('branch', 'branch'),
      makeNode('yes', 'llm'),
      makeNode('no', 'api'),
    ];
    const edges = [
      makeEdge('branch', 'yes', 'true'),
      makeEdge('branch', 'no', 'false'),
    ];
    const layers = topoSort(nodes, edges);
    expect(layers[0]).toEqual(['branch']);
    expect(layers[1]).toHaveLength(2);
    expect(layers[1]).toContain('yes');
    expect(layers[1]).toContain('no');
  });

  it('handles diamond dependency shape', () => {
    const nodes = [
      makeNode('a', 'input'),
      makeNode('b', 'llm'),
      makeNode('c', 'api'),
      makeNode('d', 'output'),
    ];
    const edges = [
      makeEdge('a', 'b'),
      makeEdge('a', 'c'),
      makeEdge('b', 'd'),
      makeEdge('c', 'd'),
    ];
    const layers = topoSort(nodes, edges);
    expect(layers).toHaveLength(3);
    expect(layers[0]).toEqual(['a']);
    expect(layers[2]).toEqual(['d']);
  });

  it('ignores edges referencing non-existent nodes', () => {
    const nodes = [makeNode('a', 'input'), makeNode('b', 'output')];
    const edges = [makeEdge('a', 'b'), makeEdge('a', 'ghost')];
    const layers = topoSort(nodes, edges);
    expect(layers).toEqual([['a'], ['b']]);
  });
});

describe('detectCycles', () => {
  it('returns empty for acyclic graph', () => {
    const nodes = [makeNode('a', 'input'), makeNode('b', 'output')];
    const edges = [makeEdge('a', 'b')];
    expect(detectCycles(nodes, edges)).toEqual([]);
  });

  it('detects a simple cycle', () => {
    const nodes = [makeNode('a', 'input'), makeNode('b', 'llm')];
    const edges = [makeEdge('a', 'b'), makeEdge('b', 'a')];
    const cycles = detectCycles(nodes, edges);
    expect(cycles.length).toBeGreaterThan(0);
  });

  it('detects cycles in a larger graph', () => {
    const nodes = [makeNode('a', 'input'), makeNode('b', 'llm'), makeNode('c', 'api')];
    const edges = [makeEdge('a', 'b'), makeEdge('b', 'c'), makeEdge('c', 'a')];
    const cycles = detectCycles(nodes, edges);
    expect(cycles.length).toBeGreaterThan(0);
  });
});

describe('getOutgoingEdges', () => {
  const edges = [
    makeEdge('a', 'b', 'true'),
    makeEdge('a', 'c', 'false'),
    makeEdge('b', 'c'),
  ];

  it('returns all outgoing edges without filter', () => {
    expect(getOutgoingEdges('a', edges)).toHaveLength(2);
  });

  it('filters by sourceHandle', () => {
    expect(getOutgoingEdges('a', edges, 'true')).toHaveLength(1);
    expect(getOutgoingEdges('a', edges, 'true')[0].target).toBe('b');
  });

  it('returns empty for node with no outgoing', () => {
    expect(getOutgoingEdges('c', edges)).toHaveLength(0);
  });
});

describe('getIncomingEdges', () => {
  const edges = [makeEdge('a', 'c'), makeEdge('b', 'c')];

  it('returns all incoming edges', () => {
    expect(getIncomingEdges('c', edges)).toHaveLength(2);
  });

  it('returns empty for node with no incoming', () => {
    expect(getIncomingEdges('a', edges)).toHaveLength(0);
  });
});
