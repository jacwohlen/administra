import { describe, expect, it } from 'vitest';
import {
  applyMigrationSql,
  authConfig,
  bootstrapAdminsSql,
  migrationVersion,
  parseClubFile,
  parseOperatorEnv,
  pendingMigrations,
  releaseBranch,
  siteEnv
} from './clubConfig.js';

const validClub = {
  slug: 'judo-muster',
  name: 'Judo Club Muster',
  domain: 'judo-muster.administra.ch',
  adminEmails: ['Praesident@Example.ch'],
  sections: ['Judo', ' Ju-Jitsu ']
};

const operatorEnv = {
  SUPABASE_ACCESS_TOKEN: 'sbp_x',
  SUPABASE_ORG_SLUG: 'org',
  NETLIFY_AUTH_TOKEN: 'nfp_x',
  NETLIFY_ACCOUNT_SLUG: 'administra',
  NETLIFY_GITHUB_INSTALLATION_ID: '123',
  GOOGLE_CLIENT_ID: 'gid',
  GOOGLE_CLIENT_SECRET: 'gsecret',
  SMTP_HOST: 'smtp.example.ch',
  SMTP_PORT: '587',
  SMTP_USER: 'user',
  SMTP_PASSWORD: 'pw',
  SMTP_SENDER_EMAIL: 'noreply@administra.ch'
};

describe('parseClubFile', () => {
  it('normalizes a valid file and fills defaults', () => {
    const club = parseClubFile(validClub, 'judo-muster');
    expect(club.adminEmails).toEqual(['praesident@example.ch']);
    expect(club.sections).toEqual(['Judo', 'Ju-Jitsu']);
    expect(club.defaultLocale).toBe('de');
    expect(club.region).toBe('eu-central-1');
  });

  it('lists every problem at once', () => {
    expect(() =>
      parseClubFile({ slug: 'Bad Slug', adminEmails: ['nope'], sections: [] }, 'x')
    ).toThrow(/slug[\s\S]*name[\s\S]*domain[\s\S]*adminEmails[\s\S]*sections/);
  });

  it('rejects a slug that differs from the file name', () => {
    expect(() => parseClubFile(validClub, 'other')).toThrow(/does not match the file name/);
  });

  it('rejects non-https urls', () => {
    expect(() => parseClubFile({ ...validClub, logo: 'http://x.ch/l.png' }, 'judo-muster')).toThrow(
      /logo/
    );
  });
});

describe('parseOperatorEnv', () => {
  it('names the missing variables', () => {
    expect(() =>
      parseOperatorEnv({ ...operatorEnv, SMTP_HOST: '', GOOGLE_CLIENT_ID: undefined })
    ).toThrow('Missing environment variables: GOOGLE_CLIENT_ID, SMTP_HOST');
  });

  it('defaults the repo and release branch', () => {
    const op = parseOperatorEnv(operatorEnv);
    expect(op.repo).toBe('jacwohlen/administra');
    expect(op.releaseBranch).toBe('clubs');
    expect(op.netlifyInstallationId).toBe(123);
  });
});

describe('authConfig', () => {
  it("uses the club's domain as the only redirect target", () => {
    const config = authConfig(
      parseClubFile(validClub, 'judo-muster'),
      parseOperatorEnv(operatorEnv),
      '<p/>'
    );
    expect(config.site_url).toBe('https://judo-muster.administra.ch');
    expect(config.uri_allow_list).toBe('https://judo-muster.administra.ch');
    expect(config.mailer_templates_magic_link_content).toBe('<p/>');
    expect(config.smtp_sender_name).toBe('Judo Club Muster (Administra)');
  });
});

describe('siteEnv', () => {
  const env = siteEnv(parseClubFile(validClub, 'judo-muster'), parseOperatorEnv(operatorEnv), {
    projectRef: 'abcdefghijklmnopqrst',
    anonKey: 'anon'
  });
  const byKey = Object.fromEntries(env.map((v) => [v.key, v]));

  it('sets every variable the build reads statically', () => {
    expect(byKey.PUBLIC_SUPABASE_DATABASE_URL.value).toBe(
      'https://abcdefghijklmnopqrst.supabase.co'
    );
    expect(byKey.PUBLIC_SUPABASE_ANON_KEY.value).toBe('anon');
    expect(byKey.PUBLIC_MODE.value).toBe('PROD');
  });

  it('leaves out unset optional values', () => {
    expect(byKey.PUBLIC_CLUB_LOGO).toBeUndefined();
    expect(byKey.PUBLIC_SENTRY_DSN).toBeUndefined();
  });

  it('marks only the SMTP password as secret', () => {
    expect(env.filter((v) => v.secret).map((v) => v.key)).toEqual(['PRIVATE_SMTP_PASSWORD']);
    expect(byKey.PRIVATE_SMTP_FROM.value).toBe('"Judo Club Muster" <noreply@administra.ch>');
  });
});

describe('bootstrapAdminsSql', () => {
  it('replaces the bootstrap admins and escapes quotes', () => {
    const sql = bootstrapAdminsSql(
      parseClubFile({ ...validClub, adminEmails: ["o'brien@example.ch"] }, 'judo-muster')
    );
    expect(sql).toContain('DELETE FROM public.bootstrap_admins;');
    expect(sql).toContain("VALUES ('o''brien@example.ch');");
  });
});

describe('pendingMigrations', () => {
  it('returns the repo versions not applied yet, in order', () => {
    expect(pendingMigrations(['3', '1', '2'], ['1'])).toEqual(['2', '3']);
  });

  it('refuses a database with versions unknown to the repo', () => {
    expect(() => pendingMigrations(['1'], ['1', '9'])).toThrow(/missing from the repo: 9/);
  });

  it('refuses pending versions older than the newest applied one', () => {
    expect(() => pendingMigrations(['1', '2', '3'], ['1', '3'])).toThrow(/would be skipped/);
  });
});

describe('migrationVersion', () => {
  it('reads the version prefix', () => {
    expect(migrationVersion('20250814155759_remote_schema.sql')).toBe('20250814155759');
    expect(migrationVersion('README.md')).toBeNull();
  });
});

describe('applyMigrationSql', () => {
  it('wraps the file and its history row in one transaction', () => {
    const sql = applyMigrationSql('20250101000000_add_x.sql', "select 'a';");
    expect(sql.startsWith('BEGIN;\n')).toBe(true);
    expect(sql.endsWith('COMMIT;')).toBe(true);
    expect(sql).toContain("VALUES ('20250101000000', 'add_x', ARRAY['select ''a'';'])");
  });

  it('refuses files with their own transaction control', () => {
    expect(() => applyMigrationSql('20250101000000_x.sql', 'begin;\nselect 1;\ncommit;')).toThrow(
      /transaction control/
    );
  });
});

describe('releaseBranch', () => {
  it('defaults to clubs and refuses working branches', () => {
    expect(releaseBranch({})).toBe('clubs');
    expect(() => releaseBranch({ CLUB_RELEASE_BRANCH: 'prod' })).toThrow(/must not be prod/);
  });
});
