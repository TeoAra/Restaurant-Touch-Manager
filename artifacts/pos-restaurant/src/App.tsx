import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import LoginPage from "@/pages/login";
import NotFound from "@/pages/not-found";
import { Layout } from "@/components/Layout";
import FrontOffice from "@/pages/front-office";
import OrdersPage from "@/pages/orders";
import BackOfficeIndex from "@/pages/backoffice/index";
import MenuPage from "@/pages/backoffice/menu";
import RoomsPage from "@/pages/backoffice/rooms";
import TablesPage from "@/pages/backoffice/tables";
import DepartmentsPage from "@/pages/backoffice/departments";
import PrintersPage from "@/pages/backoffice/printers";
import ReportsPage from "@/pages/backoffice/reports";
import PaymentsPage from "@/pages/backoffice/payments";
import SettingsPage from "@/pages/backoffice/settings";
import UsersPage from "@/pages/backoffice/users";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      refetchInterval: 15000,
    },
  },
});

function AppRouter() {
  const { user, isAdmin } = useAuth();

  // Not logged in → show login page
  if (!user) return <LoginPage />;

  return (
    <Layout>
      <Switch>
        <Route path="/" component={FrontOffice} />
        {isAdmin && <Route path="/orders" component={OrdersPage} />}
        {isAdmin && <Route path="/backoffice" component={BackOfficeIndex} />}
        {isAdmin && <Route path="/backoffice/menu" component={MenuPage} />}
        {isAdmin && <Route path="/backoffice/rooms" component={RoomsPage} />}
        {isAdmin && <Route path="/backoffice/tables" component={TablesPage} />}
        {isAdmin && <Route path="/backoffice/departments" component={DepartmentsPage} />}
        {isAdmin && <Route path="/backoffice/printers" component={PrintersPage} />}
        {isAdmin && <Route path="/backoffice/reports" component={ReportsPage} />}
        {isAdmin && <Route path="/backoffice/payments" component={PaymentsPage} />}
        {isAdmin && <Route path="/backoffice/settings" component={SettingsPage} />}
        {isAdmin && <Route path="/backoffice/users" component={UsersPage} />}
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <WouterRouter base={import.meta.env.BASE_URL?.replace(/\/$/, "") || ""}>
            <AppRouter />
          </WouterRouter>
        </AuthProvider>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
