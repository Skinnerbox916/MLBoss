import React, { ReactNode } from 'react';
import { Sidebar } from './';
import { Header } from './';

// Centralized styles
const styles = {
  layout: 'flex min-h-screen bg-[#f2f2f6]',
  mainContent: 'flex-1 min-w-0 ml-[220px] flex flex-col',
  contentContainer: 'max-w-[1280px] mx-auto w-full px-3 md:px-6 py-6',
};

interface LayoutProps {
  children: ReactNode;
  teamData?: any;
  loading?: boolean;
}

export default function Layout({ children, teamData, loading = false }: LayoutProps) {
  return (
    <div className={styles.layout}>
      {/* Sidebar */}
      <Sidebar />
      
      {/* Main content area */}
      <div className={styles.mainContent}>
        {/* Header */}
        <Header teamData={teamData} loading={loading} />
        
        {/* Content */}
        <div className={styles.contentContainer}>
          {children}
        </div>
      </div>
    </div>
  );
} 