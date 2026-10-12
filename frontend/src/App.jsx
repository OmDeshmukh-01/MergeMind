import { useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';

import LoginPage from './pages/LoginPage';
import ProjectSetupPage from './pages/ProjectSetupPage';
import DashboardLayout from './pages/DashboardLayout';
import DashboardHome from './pages/DashboardHome';
import AddDocPage from './pages/AddDocPage';
import ArchitecturePage from './pages/ArchitecturePage';
import AllPRsPage from './pages/AllPRsPage';
import PRDetailPage from './pages/PRDetailPage';

/** Redirects unauthenticated users to /login */
function ProtectedRoute({ children }) {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? children : <Navigate to="/login" replace />;
}

/** Redirects already-logged-in users away from auth pages */
function GuestRoute({ children }) {
  const { isAuthenticated } = useAuth();
  // Only redirect if they were ALREADY authenticated when they visited the route.
  // This prevents GuestRoute from hijacking the routing when a user logs in/signs up.
  const [wasAuthenticated] = useState(isAuthenticated);
  
  return wasAuthenticated ? <Navigate to="/dashboard" replace /> : children;
}

export default function App() {
  return (
    <Routes>
      {/* Root → redirect based on auth state */}
      <Route path="/" element={<Navigate to="/login" replace />} />

      {/* Auth routes — only for guests */}
      <Route
        path="/login"
        element={
          <GuestRoute>
            <LoginPage mode="login" />
          </GuestRoute>
        }
      />
      <Route
        path="/register"
        element={
          <GuestRoute>
            <LoginPage mode="register" />
          </GuestRoute>
        }
      />

      {/* Project setup — requires auth */}
      <Route
        path="/setup"
        element={
          <ProtectedRoute>
            <ProjectSetupPage />
          </ProtectedRoute>
        }
      />

      {/* Dashboard — nested layout, requires auth */}
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <DashboardLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<DashboardHome />} />
        <Route path="add-doc" element={<AddDocPage />} />
        <Route path="architecture" element={<ArchitecturePage />} />
        <Route path="all-prs" element={<AllPRsPage />} />
        <Route path="pr/:prNumber" element={<PRDetailPage />} />
      </Route>

      {/* Catch-all → redirect to login */}
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
