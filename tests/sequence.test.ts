import { describe, it, expect } from 'vitest';
import { sequentialQuestions, remainingFrom, findStartIndex, displayNumber } from '../src/utils/sequence';
import type { Question } from '../src/types';

function q(id: number, sourceNumber?: string): Question {
  return { id, sourceNumber, text: `Q${id}`, options: [], selectCount: 1 };
}

const ALL = [q(1, '1'), q(2, '2'), q(3, '3'), q(4, '4'), q(5, '5')];

describe('sequentialQuestions', () => {
  it('starts at the first question when startFrom is unset', () => {
    expect(sequentialQuestions(ALL, undefined, 3).map((x) => x.id)).toEqual([1, 2, 3]);
  });

  it('starts at a middle question number', () => {
    expect(sequentialQuestions(ALL, 3, 2).map((x) => x.id)).toEqual([3, 4]);
  });

  it('falls back to the first question when the number is not found', () => {
    expect(sequentialQuestions(ALL, 99, 2).map((x) => x.id)).toEqual([1, 2]);
  });

  it('clamps count to the questions remaining from the start point', () => {
    expect(sequentialQuestions(ALL, 4, 10).map((x) => x.id)).toEqual([4, 5]);
  });

  it('matches sourceNumber when present and falls back to id', () => {
    const mixed = [q(1, 'T2-14'), q(2), q(3, 'T2-16')];
    expect(sequentialQuestions(mixed, 2, 2).map((x) => x.id)).toEqual([2, 3]);
    expect(sequentialQuestions(mixed, 14, 1).map((x) => x.id)).toEqual([1]); // no displayed number 14 → first
  });

  it('sorts unsorted input by id (dataset order)', () => {
    const unsorted = [q(5), q(2), q(4), q(1), q(3)];
    expect(sequentialQuestions(unsorted, 2, 3).map((x) => x.id)).toEqual([2, 3, 4]);
  });

  it('returns an empty list for a non-positive count', () => {
    expect(sequentialQuestions(ALL, 1, 0)).toEqual([]);
  });
});

describe('remainingFrom', () => {
  it('counts every question when startFrom is unset or not found', () => {
    expect(remainingFrom(ALL, undefined)).toBe(5);
    expect(remainingFrom(ALL, 99)).toBe(5);
  });

  it('counts from the start question to the end', () => {
    expect(remainingFrom(ALL, 3)).toBe(3);
    expect(remainingFrom(ALL, 5)).toBe(1);
  });
});

describe('findStartIndex and displayNumber', () => {
  it('finds the index of the displayed number, 0 when unset or not found', () => {
    expect(findStartIndex(ALL, 3)).toBe(2);
    expect(findStartIndex(ALL, undefined)).toBe(0);
    expect(findStartIndex(ALL, 42)).toBe(0);
  });

  it('displayNumber prefers sourceNumber', () => {
    expect(displayNumber(q(7, 'T2-14'))).toBe('T2-14');
    expect(displayNumber(q(7))).toBe('7');
  });
});
