'use client';
import { useState } from 'react';
import { useActions } from '@/lib/client/actions';
import { useViewer } from '@/lib/client/viewer';

export function FollowButton({ target, following: initial = false }: { target: string; following?: boolean }) {
  const actions = useActions();
  const v = useViewer();
  const [following, setFollowing] = useState(initial);
  const [hover, setHover] = useState(false);
  if (v.profile?.address === target) return null;
  return (
    <button
      type="button"
      className={following ? 'btn btn-following' : 'btn btn-cyan'}
      aria-pressed={following}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={async () => {
        const next = !following;
        setFollowing(next);
        const ok = await actions.follow(target, next);
        if (!ok) setFollowing(!next);
      }}
    >
      {following ? (hover ? 'Unfollow' : 'Following') : 'Follow'}
    </button>
  );
}
