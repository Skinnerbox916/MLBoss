import { FiShoppingCart } from 'react-icons/fi';
import DashboardCard from '../DashboardCard';

export default function WaiversCard() {
  // TODO: Add useWaivers hook for data fetching
  const isLoading = false;

  return (
    <DashboardCard
      title="Waivers"
      icon={FiShoppingCart}
      size="md"
      isLoading={isLoading}
    >
      <div className="space-y-3">
        <div className="flex justify-between items-center">
          <span className="text-sm text-foreground opacity-80">Waiver Priority</span>
          <span className="font-semibold text-lg">#3</span>
        </div>
        
        <div className="space-y-2">
          <div className="text-xs text-foreground opacity-60">Active Claims</div>
          <div className="space-y-1">
            <div className="flex justify-between items-center p-2 bg-primary-50 rounded">
              <span className="text-sm font-medium">K. Tucker</span>
              <span className="text-xs text-primary">Pending</span>
            </div>
            <div className="flex justify-between items-center p-2 bg-primary-50 rounded">
              <span className="text-sm">C. Seager</span>
              <span className="text-xs text-foreground opacity-60">Processing</span>
            </div>
          </div>
        </div>

        <div className="pt-2 border-t border-primary-200 dark:border-primary-700">
          <div className="text-xs text-foreground opacity-60 mb-1">Hot Pickups</div>
          <div className="text-sm">
            <span className="font-medium">J. Altuve</span>
            <span className="text-foreground opacity-60 ml-2">+47% added</span>
          </div>
        </div>
      </div>
    </DashboardCard>
  );
} 