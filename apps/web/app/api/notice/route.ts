import { currentNotice } from '@uproar/safety';
import { getSql } from '@/lib/server/db';
import { failure, json } from '@/lib/server/http';

export async function GET() {
  try {
    return json(await currentNotice(getSql()));
  } catch (error) {
    return failure(error);
  }
}
