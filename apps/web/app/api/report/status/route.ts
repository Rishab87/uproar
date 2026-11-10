import { reportStatus } from '@uproar/safety';
import type { NextRequest } from 'next/server';
import { getSql } from '@/lib/server/db';
import { bad, failure, json } from '@/lib/server/http';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const status = await reportStatus(getSql(), searchParams.get('ref') ?? '', searchParams.get('token') ?? '');
    return status ? json(status) : bad('No report matches that reference and token', 404);
  } catch (error) {
    return failure(error);
  }
}
