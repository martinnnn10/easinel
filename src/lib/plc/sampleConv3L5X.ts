// A realistic (compact) RSLogix5000/Studio 5000 L5X export for the Conveyor 3
// demo asset. It exercises every Explorer node type: controller, a continuous
// task, a program with ladder + Structured Text routines, controller- and
// program-scoped tags, an Add-On Instruction, a UDT, and I/O modules — with
// real ladder rungs so cross-references resolve. Kept inline so the seed has
// zero filesystem dependencies.

export const CONV3_L5X = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<RSLogix5000Content SchemaRevision="1.0" SoftwareRevision="32.00" TargetName="Conveyor3_PKG2" TargetType="Controller" ExportDate="Wed May 07 2025" ExportOptions="References NoRawData">
<Controller Use="Target" Name="Conveyor3_PKG2" ProcessorType="1769-L24ER-QB1B" MajorRev="32" MinorRev="11">
<Description><![CDATA[Packaging Line 2 — Conveyor 3 takeaway control (PowerFlex 525 VFD-CONV3 on EtherNet/IP).]]></Description>
<DataTypes>
<DataType Name="Conveyor_State" Family="NoFamily" Class="User">
<Description><![CDATA[Aggregated state for one conveyor: commands, status and faults in a single structured tag.]]></Description>
<Members>
<Member Name="Run_Cmd" DataType="BOOL" Dimension="0" Radix="Decimal"><Description><![CDATA[Operator/PLC run command]]></Description></Member>
<Member Name="Running" DataType="BOOL" Dimension="0" Radix="Decimal"><Description><![CDATA[Drive reports running]]></Description></Member>
<Member Name="Faulted" DataType="BOOL" Dimension="0" Radix="Decimal"><Description><![CDATA[Drive faulted]]></Description></Member>
<Member Name="Fault_Code" DataType="DINT" Dimension="0" Radix="Decimal"><Description><![CDATA[Active drive fault code]]></Description></Member>
<Member Name="Output_Current" DataType="REAL" Dimension="0" Radix="Float"><Description><![CDATA[Drive output current (A)]]></Description></Member>
<Member Name="Speed_Ref" DataType="REAL" Dimension="0" Radix="Float"><Description><![CDATA[Speed reference (Hz)]]></Description></Member>
</Members>
</DataType>
</DataTypes>
<AddOnInstructionDefinitions>
<AddOnInstructionDefinition Name="VFD_Control" Revision="1.2" Class="Standard">
<Description><![CDATA[Standard PowerFlex run/stop control with fault latch and overload watch.]]></Description>
<Parameters>
<Parameter Name="EnableIn" Usage="Input" DataType="BOOL" Required="false" Visible="false"/>
<Parameter Name="Run_Request" Usage="Input" DataType="BOOL" Required="true" Visible="true"><Description><![CDATA[Request the drive to run]]></Description></Parameter>
<Parameter Name="Drive_Faulted" Usage="Input" DataType="BOOL" Required="true" Visible="true"><Description><![CDATA[Drive fault status from EtherNet/IP]]></Description></Parameter>
<Parameter Name="Output_Current" Usage="Input" DataType="REAL" Required="true" Visible="true"><Description><![CDATA[Drive output current feedback]]></Description></Parameter>
<Parameter Name="Run_Out" Usage="Output" DataType="BOOL" Required="true" Visible="true"><Description><![CDATA[Run output to the drive]]></Description></Parameter>
<Parameter Name="Overload_Warn" Usage="Output" DataType="BOOL" Required="true" Visible="true"><Description><![CDATA[Set when current approaches OL limit]]></Description></Parameter>
</Parameters>
<LocalTags>
<LocalTag Name="OL_Threshold" DataType="REAL"><Description><![CDATA[Overload warning threshold (A)]]></Description></LocalTag>
</LocalTags>
<Routines>
<Routine Name="Logic" Type="RLL">
<RLLContent>
<Rung Number="0" Type="N"><Comment><![CDATA[Run the drive when requested and not faulted]]></Comment><Text><![CDATA[XIC(Run_Request)XIO(Drive_Faulted)OTE(Run_Out);]]></Text></Rung>
<Rung Number="1" Type="N"><Comment><![CDATA[Warn when output current nears the overload threshold]]></Comment><Text><![CDATA[GRT(Output_Current,OL_Threshold)OTE(Overload_Warn);]]></Text></Rung>
</RLLContent>
</Routine>
</Routines>
</AddOnInstructionDefinition>
</AddOnInstructionDefinitions>
<Tags>
<Tag Name="Conv3" TagType="Base" DataType="Conveyor_State" Constant="false"><Description><![CDATA[Conveyor 3 aggregated state]]></Description></Tag>
<Tag Name="VFD_CONV3_Current" TagType="Base" DataType="REAL" Radix="Float" Constant="false"><Description><![CDATA[VFD-CONV3 output current (A), from EtherNet/IP]]></Description></Tag>
<Tag Name="VFD_CONV3_Fault" TagType="Base" DataType="BOOL" Radix="Decimal" Constant="false"><Description><![CDATA[VFD-CONV3 fault bit]]></Description></Tag>
<Tag Name="Conv3_Run_PB" TagType="Base" DataType="BOOL" Radix="Decimal" Constant="false"><Description><![CDATA[Operator run pushbutton (HMI)]]></Description></Tag>
<Tag Name="Conv3_Estop_OK" TagType="Base" DataType="BOOL" Radix="Decimal" Constant="false"><Description><![CDATA[E-stop string healthy (gate GS-3 + pull-cord PC-3)]]></Description></Tag>
<Tag Name="Panel_Temp_C" TagType="Base" DataType="REAL" Radix="Float" Constant="false"><Description><![CDATA[VFD panel temperature (deg C)]]></Description></Tag>
<Tag Name="OL_Current_Limit" TagType="Base" DataType="REAL" Radix="Float" Constant="true"><Description><![CDATA[Motor FLA overload limit (7.6 A)]]></Description></Tag>
</Tags>
<Programs>
<Program Name="ConveyorControl" MainRoutineName="MainRoutine" Class="Standard">
<Description><![CDATA[Conveyor 3 run/stop sequencing, drive control and overload monitoring.]]></Description>
<Tags>
<Tag Name="Run_Latch" TagType="Base" DataType="BOOL" Radix="Decimal" Constant="false"><Description><![CDATA[Latched run state]]></Description></Tag>
<Tag Name="Warmup_Timer" TagType="Base" DataType="TIMER" Constant="false"><Description><![CDATA[Run-time accumulator for thermal watch]]></Description></Tag>
<Tag Name="Drive_Ctrl" TagType="Base" DataType="VFD_Control" Constant="false"><Description><![CDATA[VFD control AOI instance for Conveyor 3]]></Description></Tag>
</Tags>
<Routines>
<Routine Name="MainRoutine" Type="RLL">
<Description><![CDATA[Top-level sequencing — calls Start/Stop and overload monitor.]]></Description>
<RLLContent>
<Rung Number="0" Type="N"><Comment><![CDATA[Run permissive: e-stop healthy and not faulted]]></Comment><Text><![CDATA[XIC(Conv3_Estop_OK)XIO(VFD_CONV3_Fault)JSR(StartStop,0);]]></Text></Rung>
<Rung Number="1" Type="N"><Comment><![CDATA[Always evaluate the overload monitor]]></Comment><Text><![CDATA[JSR(OverloadMonitor,0);]]></Text></Rung>
<Rung Number="2" Type="N"><Comment><![CDATA[Drive the PowerFlex through the VFD_Control AOI]]></Comment><Text><![CDATA[VFD_Control(Drive_Ctrl,Run_Latch,VFD_CONV3_Fault,VFD_CONV3_Current,Conv3.Running,Conv3.Faulted);]]></Text></Rung>
</RLLContent>
</Routine>
<Routine Name="StartStop" Type="RLL">
<Description><![CDATA[Seal-in run control from the operator pushbutton.]]></Description>
<RLLContent>
<Rung Number="0" Type="N"><Comment><![CDATA[Seal-in: start on PB, hold on Run_Latch, drop on e-stop]]></Comment><Text><![CDATA[XIC(Conv3_Run_PB)XIC(Conv3_Estop_OK)OTL(Run_Latch);]]></Text></Rung>
<Rung Number="1" Type="N"><Comment><![CDATA[Unlatch run on fault]]></Comment><Text><![CDATA[XIC(VFD_CONV3_Fault)OTU(Run_Latch);]]></Text></Rung>
<Rung Number="2" Type="N"><Text><![CDATA[XIC(Run_Latch)OTE(Conv3.Run_Cmd);]]></Text></Rung>
</RLLContent>
</Routine>
<Routine Name="OverloadMonitor" Type="ST">
<Description><![CDATA[Thermal/overload watch — trends output current and panel temperature.]]></Description>
<STContent>
<Line Number="0"><![CDATA[(* Copy live drive current into the state tag *)]]></Line>
<Line Number="1"><![CDATA[Conv3.Output_Current := VFD_CONV3_Current;]]></Line>
<Line Number="2"><![CDATA[IF VFD_CONV3_Current >= OL_Current_Limit THEN]]></Line>
<Line Number="3"><![CDATA[    Conv3.Faulted := 1;]]></Line>
<Line Number="4"><![CDATA[    Conv3.Fault_Code := 7; (* F007 motor overload *)]]></Line>
<Line Number="5"><![CDATA[END_IF;]]></Line>
<Line Number="6"><![CDATA[(* Flag when panel temperature is heat-soaking *)]]></Line>
<Line Number="7"><![CDATA[IF Panel_Temp_C > 55.0 THEN Conv3.Faulted := 1; END_IF;]]></Line>
</STContent>
</Routine>
</Routines>
</Program>
</Programs>
<Tasks>
<Task Name="MainTask" Type="CONTINUOUS" Priority="10" Watchdog="500">
<ScheduledPrograms>
<ScheduledProgram Name="ConveyorControl"/>
</ScheduledPrograms>
</Task>
</Tasks>
<Modules>
<Module Name="Local" CatalogNumber="1769-L24ER-QB1B" Vendor="1" ProductType="14" ParentModule="Local">
<Description><![CDATA[CompactLogix controller]]></Description>
</Module>
<Module Name="VFD_CONV3" CatalogNumber="PowerFlex 525-EENET" Vendor="1" ProductType="121" ParentModule="Local">
<Description><![CDATA[PowerFlex 525 drive for Conveyor 3 on EtherNet/IP]]></Description>
</Module>
</Modules>
</Controller>
</RSLogix5000Content>`;
