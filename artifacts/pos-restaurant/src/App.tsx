import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
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

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      refetchInterval: 15000,
    },
  },
});

function AppRouter() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={FrontOffice} />
        <Route path="/orders" component={OrdersPage} />
        <Route path="/backoffice" component={BackOfficeIndex} />
        <Route path="/backoffice/menu" component={MenuPage} />
        <Route path="/backoffice/rooms" component={RoomsPage} />
        <Route path="/backoffice/tables" component={TablesPage} />
        <Route path="/backoffice/departments" component={DepartmentsPage} />
        <Route path="/backoffice/printers" component={PrintersPage} />
        <Route path="/backoffice/reports" component={ReportsPage} />
        <Route path="/backoffice/payments" component={PaymentsPage} />
        <Route path="/backoffice/settings" component={SettingsPage} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL?.replace(/\/$/, "") || ""}>
          <AppRouter />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
