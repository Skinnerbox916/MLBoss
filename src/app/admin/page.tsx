import AppLayout from '@/components/layout/AppLayout';
import Link from 'next/link';

export default async function AdminPage() {
  return (
    <AppLayout>
      <main className="flex-1 overflow-y-auto bg-background">
        <div className="max-w-7xl mx-auto py-4 px-4">
          <div className="mb-6">
            <h2 className="text-lg font-semibold text-foreground">Admin</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <AdminCard
              href="/admin/debug"
              title="API Health & Debug"
              description="Probe all data sources, check session and league status"
            />
            <AdminCard
              href="/admin/cache"
              title="Cache"
              description="View cached keys by tier, clear stale data"
            />
          </div>
        </div>
      </main>
    </AppLayout>
  );
}

function AdminCard({ href, title, description }: { href: string; title: string; description: string }) {
  return (
    <Link href={href} className="block">
      <div className="bg-surface rounded-lg border border-border p-5 hover:border-primary/40 transition-colors">
        <h3 className="text-sm font-semibold text-foreground mb-1">{title}</h3>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
    </Link>
  );
}
