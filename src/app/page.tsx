import Image from "next/image";

export default function Home() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
      <div className="bg-white dark:bg-gray-800 shadow-lg rounded-xl p-8 max-w-md w-full text-center">
        <Image
          src="/mlboss-logo.png"
          alt="MLBoss Logo"
          width={240}
          height={144}
          className="mx-auto mb-6"
          priority
        />
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Welcome to MLBoss</h1>
      </div>
    </div>
  );
}
