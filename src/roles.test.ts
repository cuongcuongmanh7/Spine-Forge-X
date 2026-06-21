import { describe, expect, it } from 'vitest';
import { computeIsLeader } from './roles';

const LEADERS = ['cuongdm@ondigames.com'];

describe('computeIsLeader', () => {
  it('matches a leader email case-insensitively, ignoring surrounding space', () => {
    expect(computeIsLeader('cuongdm@ondigames.com', LEADERS)).toBe(true);
    expect(computeIsLeader('CuongDM@Ondigames.com', LEADERS)).toBe(true);
    expect(computeIsLeader('  cuongdm@ondigames.com  ', LEADERS)).toBe(true);
    expect(computeIsLeader('member@ondigames.com', ['A@x.com', 'member@ondigames.com'])).toBe(true);
  });

  it('treats non-listed / missing emails as members', () => {
    expect(computeIsLeader('someone@ondigames.com', LEADERS)).toBe(false);
    expect(computeIsLeader('cuongdm@gmail.com', LEADERS)).toBe(false);
    expect(computeIsLeader(null, LEADERS)).toBe(false);
    expect(computeIsLeader(undefined, LEADERS)).toBe(false);
    expect(computeIsLeader('', LEADERS)).toBe(false);
    expect(computeIsLeader('cuongdm@ondigames.com', [])).toBe(false);
  });
});
