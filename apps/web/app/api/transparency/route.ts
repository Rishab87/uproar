import { transparency } from '@uproar/safety';
import { getSql } from '@/lib/server/db';
import { failure, json } from '@/lib/server/http';

export async function GET() {
  try {
    return json(await transparency(getSql()));
  } catch (error) {
    return failure(error);
  }
}
