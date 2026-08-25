import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';

/** argon2id everywhere (01-stage1-plan.md locked decisions; api-spec §3). */
@Injectable()
export class PasswordService {
  hash(plain: string): Promise<string> {
    return argon2.hash(plain, { type: argon2.argon2id });
  }

  verify(hash: string, plain: string): Promise<boolean> {
    return argon2.verify(hash, plain).catch(() => false);
  }
}
