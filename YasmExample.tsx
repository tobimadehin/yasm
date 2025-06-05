import React from "react";
import { useCached } from "yasm";

interface User {
  name: string;
  email: string;
}

interface UserProfileProps {
  userId: string;
}

function UserProfile({ userId }: UserProfileProps) {
  // YASM: "useState but cached" - One simple line!
  const {
    data: user,
    loading,
    error,
  } = useCached(
    `user-${userId}`,
    async () => {
      const response = await fetch(`/api/users/${userId}`);
      return response.json();
    },
    300000 // Cache for 5 minutes 
  );

  if (loading) return <div>Loading user...</div>;
  if (error) return <div>Error: {(error as Error).message}</div>;

  return (
    <div>
      <h2>{user?.name}</h2>
      <p>{user?.email}</p>
    </div>
  );
}

export { UserProfile };
