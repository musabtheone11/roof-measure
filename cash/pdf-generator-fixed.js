// Fixed PDF Generator for Diversity Roofing
function generateWorkingPDF() {
    // Validate required fields
    const requiredFields = ['customerName', 'phoneNumber', 'propertyAddress', 'squareFootage'];
    let isValid = true;
    
    requiredFields.forEach(fieldId => {
        const field = document.getElementById(fieldId);
        if (!field.value.trim()) {
            field.style.borderColor = '#ef4444';
            isValid = false;
        } else {
            field.style.borderColor = '#e9ecef';
        }
    });
    
    if (!isValid) {
        alert('Please fill in all required fields before generating proposal.');
        return;
    }
    
    // Check if margin has been selected
    if (selectedMargin === 0) {
        if (confirm('No profit margin selected. Do you want to generate proposal with base pricing?')) {
            // Proceed with base pricing
        } else {
            return;
        }
    }
    
    // Show loading animation
    const button = event.target;
    const originalText = button.textContent;
    button.textContent = '⏳ Generating PDF...';
    button.disabled = true;
    
    // Generate proposal data
    const proposalData = {
        companyInfo: {
            name: "Diversity Contracting And Roofing LLC",
            phone: "(904) 979-0556",
            email: "Jacksonville@Diversity-Roofing.com",
            website: "www.Diversity-Roofing.com",
            address: "10151 Deerwood Park Blvd, Bldg 200, Ste 250, Jacksonville, FL 32256"
        },
        customerInfo: {
            name: document.getElementById('customerName').value,
            phone: document.getElementById('phoneNumber').value,
            email: document.getElementById('emailAddress').value,
            address: document.getElementById('propertyAddress').value
        },
        projectDetails: {
            squareFootage: document.getElementById('squareFootage').value,
            stories: parseInt(document.getElementById('stories').value),
            roofPitch: document.getElementById('roofPitch').value,
            material: selectedMaterial,
            description: document.getElementById('projectDescription').value,
            startDate: document.getElementById('startDate').value || 'TBD',
            completionDate: document.getElementById('completionDate').value || 'TBD'
        },
        costs: {
            finalPrice: formatCurrency(customerPrice > 0 ? customerPrice : baseCost + overheadCost),
            cashPrice: formatCurrency((customerPrice > 0 ? customerPrice : baseCost + overheadCost) * 0.95)
        }
    };
    
    // Create PDF using a simpler approach
    setTimeout(() => {
        try {
            // Check if jsPDF is available
            if (typeof window.jspdf === 'undefined') {
                // Fallback: Create a downloadable text file that looks like a proposal
                createProposalTextFile(proposalData);
                return;
            }
            
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF();
            
            // Colors
            const primaryColor = [44, 62, 80]; // #2C3E50
            const accentColor = [230, 126, 34]; // #E67E22
            const textColor = [51, 51, 51]; // #333333
            
            const pageWidth = doc.internal.pageSize.getWidth();
            const pageHeight = doc.internal.pageSize.getHeight();
            const margin = 20;
            let currentY = margin;
            
            // Header with logo
            doc.setFillColor(...primaryColor);
            doc.rect(0, 0, pageWidth, 40, 'F');
            
            // Try to add logo
            try {
                doc.addImage('diversity-logo.png', 'PNG', margin, 10, 35, 18);
                
                // Company name next to logo
                doc.setTextColor(255, 255, 255);
                doc.setFontSize(18);
                doc.setFont('helvetica', 'bold');
                doc.text('DIVERSITY ROOFING', margin + 40, 22);
                
                doc.setFontSize(10);
                doc.text('Professional Roofing Estimate', margin + 40, 32);
            } catch (logoError) {
                // Fallback without logo
                doc.setTextColor(255, 255, 255);
                doc.setFontSize(20);
                doc.setFont('helvetica', 'bold');
                doc.text('DIVERSITY ROOFING', margin, 25);
                
                doc.setFontSize(12);
                doc.text('Professional Roofing Estimate', margin, 38);
            }
            
            // Company info
            doc.setFontSize(10);
            doc.text(proposalData.companyInfo.phone, pageWidth - margin - 60, 20);
            doc.text(proposalData.companyInfo.email, pageWidth - margin - 60, 28);
            doc.text(proposalData.companyInfo.website, pageWidth - margin - 60, 36);
            
            currentY = 60;
            
            // Customer Info Box
            doc.setFillColor(248, 249, 250);
            doc.rect(margin, currentY - 5, pageWidth - 2 * margin, 30, 'F');
            
            doc.setTextColor(...primaryColor);
            doc.setFontSize(12);
            doc.setFont('helvetica', 'bold');
            doc.text('CUSTOMER INFORMATION', margin + 5, currentY);
            
            currentY += 8;
            doc.setTextColor(...textColor);
            doc.setFontSize(10);
            doc.setFont('helvetica', 'normal');
            
            doc.text(`Name: ${proposalData.customerInfo.name}`, margin + 5, currentY);
            currentY += 5;
            doc.text(`Phone: ${proposalData.customerInfo.phone}`, margin + 5, currentY);
            currentY += 5;
            doc.text(`Address: ${proposalData.customerInfo.address}`, margin + 5, currentY);
            
            currentY += 15;
            
            // Project Details
            doc.setTextColor(...primaryColor);
            doc.setFontSize(12);
            doc.setFont('helvetica', 'bold');
            doc.text('PROJECT DETAILS', margin, currentY);
            
            currentY += 8;
            doc.setTextColor(...textColor);
            doc.setFontSize(10);
            
            const details = [
                `Total Area: ${proposalData.projectDetails.squareFootage} sq ft`,
                `Stories: ${proposalData.projectDetails.stories}`,
                `Pitch: ${proposalData.projectDetails.roofPitch}`,
                `Material: ${proposalData.projectDetails.material}`,
                `Start: ${proposalData.projectDetails.startDate}`,
                `Completion: ${proposalData.projectDetails.completionDate}`
            ];
            
            details.forEach(detail => {
                doc.text(detail, margin, currentY);
                currentY += 5;
            });
            
            currentY += 20;
            
            // Price Box
            doc.setFillColor(...accentColor);
            doc.rect(margin, currentY - 10, pageWidth - 2 * margin, 35, 'F');
            
            doc.setTextColor(255, 255, 255);
            doc.setFontSize(16);
            doc.setFont('helvetica', 'bold');
            doc.text('TOTAL PROJECT INVESTMENT', margin + 10, currentY);
            
            currentY += 15;
            doc.setFontSize(24);
            doc.text(proposalData.costs.finalPrice, margin + 10, currentY);
            
            doc.setFontSize(12);
            doc.text(`Cash Price: ${proposalData.costs.cashPrice}`, margin + 10, currentY + 12);
            
            currentY += 40;
            
            // Scope of Work
            doc.setTextColor(...primaryColor);
            doc.setFontSize(14);
            doc.setFont('helvetica', 'bold');
            doc.text('SCOPE OF WORK', margin, currentY);
            
            currentY += 8;
            doc.setTextColor(...textColor);
            doc.setFontSize(10);
            
            const scopeLines = doc.splitTextToSize(proposalData.projectDetails.description, pageWidth - 2 * margin);
            scopeLines.forEach(line => {
                if (currentY > pageHeight - 100) {
                    doc.addPage();
                    currentY = margin;
                }
                doc.text(line, margin, currentY);
                currentY += 5;
            });
            
            currentY += 15;
            
            // Warranty Section
            if (currentY > pageHeight - 80) {
                doc.addPage();
                currentY = margin;
            }
            
            doc.setTextColor(...primaryColor);
            doc.setFontSize(12);
            doc.setFont('helvetica', 'bold');
            doc.text('WARRANTY & GUARANTEES', margin, currentY);
            
            currentY += 8;
            doc.setTextColor(...textColor);
            doc.setFontSize(10);
            
            const warranties = [
                '✓ 10-Year Labor Warranty',
                '✓ Manufacturer Limited Lifetime Shingle Warranty',
                '✓ Fully Licensed and Insured',
                '✓ Project Manager on Every Job Site',
                '✓ Site Visit Before Project Start',
                '✓ Before/During/After Photos with Drone Shots'
            ];
            
            warranties.forEach(warranty => {
                if (currentY > pageHeight - 50) {
                    doc.addPage();
                    currentY = margin;
                }
                doc.text(warranty, margin, currentY);
                currentY += 6;
            });
            
            currentY += 15;
            
            // Terms
            if (currentY > pageHeight - 60) {
                doc.addPage();
                currentY = margin;
            }
            
            doc.setTextColor(...primaryColor);
            doc.setFontSize(12);
            doc.setFont('helvetica', 'bold');
            doc.text('TERMS & CONDITIONS', margin, currentY);
            
            currentY += 8;
            doc.setTextColor(...textColor);
            doc.setFontSize(9);
            
            const terms = [
                'Payment Terms: 50% deposit due upon contract signing, 50% due upon completion',
                'Validity: This estimate is valid for 30 days from the date issued',
                'This proposal includes complete roof replacement with premium materials'
            ];
            
            terms.forEach(term => {
                if (currentY > pageHeight - 40) {
                    doc.addPage();
                    currentY = margin;
                }
                const termLines = doc.splitTextToSize(term, pageWidth - 2 * margin);
                termLines.forEach(line => {
                    doc.text(line, margin, currentY);
                    currentY += 4;
                });
            });
            
            // Footer
            const footerY = pageHeight - 25;
            doc.setFillColor(...primaryColor);
            doc.rect(0, footerY, pageWidth, 25, 'F');
            
            doc.setTextColor(255, 255, 255);
            doc.setFontSize(9);
            doc.setFont('helvetica', 'normal');
            doc.text('Thank you for choosing Diversity Roofing!', margin, footerY + 8);
            doc.text(`${proposalData.companyInfo.phone} | ${proposalData.companyInfo.email}`, margin, footerY + 15);
            doc.text(`Generated: ${new Date().toLocaleDateString()}`, pageWidth - margin - 50, footerY + 15);
            
            // Save the PDF
            const fileName = `Diversity-Roofing-Proposal-${proposalData.customerInfo.name.replace(/\s+/g, '-')}.pdf`;
            doc.save(fileName);
            
            alert(`Professional PDF proposal generated successfully for ${proposalData.customerInfo.name}! 
            
✅ Professional PDF document has been created and downloaded
✅ Customer-focused format with final pricing only
✅ Final Customer Price: ${proposalData.costs.finalPrice}
✅ Cash Price: ${proposalData.costs.cashPrice}
✅ File saved as: ${fileName}
            
The proposal includes:
✅ Professional header with Diversity Roofing branding
✅ Customer information and project details
✅ Final pricing (no cost breakdown shown to customer)
✅ Detailed scope of work
✅ Warranty and guarantee information
✅ Payment terms and conditions
✅ Professional footer with contact information

This is a complete, professional customer-ready proposal.`);
            
            button.textContent = originalText;
            button.disabled = false;
            
            // Animate success
            anime({
                targets: button,
                scale: [1, 1.05, 1],
                backgroundColor: ['#E67E22', '#27AE60', '#E67E22'],
                duration: 600,
                easing: 'easeOutQuart'
            });
        } catch (error) {
            console.error('Error generating PDF:', error);
            // Fallback to text file
            createProposalTextFile(proposalData);
        }
    }, 2000);
}

// Fallback function to create a text file proposal
function createProposalTextFile(proposalData) {
    const subtotalWithOverhead = baseCost + overheadCost;
    const finalPrice = customerPrice > 0 ? customerPrice : subtotalWithOverhead;
    
    const proposalContent = `DIVERSITY ROOFING - PROFESSIONAL ESTIMATE
=====================================

COMPANY INFORMATION:
Company: Diversity Contracting And Roofing LLC
Phone: (904) 979-0556
Email: Jacksonville@Diversity-Roofing.com
Website: www.Diversity-Roofing.com
Address: 10151 Deerwood Park Blvd, Bldg 200, Ste 250, Jacksonville, FL 32256

CUSTOMER INFORMATION:
Name: ${proposalData.customerInfo.name}
Phone: ${proposalData.customerInfo.phone}
Email: ${proposalData.customerInfo.email}
Address: ${proposalData.customerInfo.address}

PROJECT DETAILS:
Square Footage: ${proposalData.projectDetails.squareFootage} sq ft
Stories: ${proposalData.projectDetails.stories}
Roof Pitch: ${proposalData.projectDetails.roofPitch}
Material: ${proposalData.projectDetails.material}
Start Date: ${proposalData.projectDetails.startDate}
Completion Date: ${proposalData.projectDetails.completionDate}

FINAL PRICING:
Total Project Investment: ${formatCurrency(finalPrice)}
Cash Price (5% discount): ${formatCurrency(finalPrice * 0.95)}

SCOPE OF WORK:
${proposalData.projectDetails.description}

WARRANTY & GUARANTEES:
✓ 10-Year Labor Warranty
✓ Manufacturer's Limited Lifetime Shingle Warranty
✓ Fully Licensed and Insured
✓ Project Manager on Every Job Site
✓ Site Visit Before Project Start
✓ Before/During/After Photos with Drone Shots

PAYMENT TERMS:
50% deposit due upon contract signing, 50% due upon completion
NET 7 payment terms

VALIDITY:
This estimate is valid for 30 days from the date issued

ADDITIONAL NOTES:
- This estimate includes all materials, labor, permits, and disposal
- Site visit before project start
- Project manager on every job site
- Unmarked vehicles representing your company
- Before/during/after photos with drone shots
- 10-year labor warranty included

Thank you for choosing Diversity Roofing!

Generated on: ${new Date().toLocaleDateString()}
Estimate ID: DR-${Date.now()}`;
    
    const blob = new Blob([proposalContent], { type: 'text/plain' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Diversity-Roofing-Proposal-${proposalData.customerInfo.name.replace(/\s+/g, '-')}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
    
    alert(`Proposal document generated successfully for ${proposalData.customerInfo.name}! 
    
✅ A text file proposal has been created and downloaded
✅ File saved as: Diversity-Roofing-Proposal-${proposalData.customerInfo.name.replace(/\s+/g, '-')}.txt
✅ Final Customer Price: ${formatCurrency(finalPrice)}
✅ Cash Price: ${formatCurrency(finalPrice * 0.95)}
    
The proposal includes all customer information, project details, final pricing, scope of work, and warranty information. You can open this file in any text editor and copy the content to create a more formatted document if needed.`);
}