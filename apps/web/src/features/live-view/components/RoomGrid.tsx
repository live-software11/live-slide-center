import type { LiveEventSnapshot } from '../repository';
import { RoomCard } from './RoomCard';

interface Props {
  snapshot: LiveEventSnapshot;
}

export function RoomGrid({ snapshot }: Props) {
  if (snapshot.rooms.length === 0) return null;

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
      {snapshot.rooms.map((roomData) => (
        <RoomCard key={roomData.room.id} data={roomData} />
      ))}
    </div>
  );
}
